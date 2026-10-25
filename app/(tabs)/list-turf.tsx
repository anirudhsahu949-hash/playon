/**
 * app/list-turf.tsx — one form, two modes.
 *
 *  OWNER mode (default, e.g. from Grow with PlayOn) — "List Your Turf"
 *    Owner name / phone / email + plan (Free listing · Online booking · Not sure).
 *    Anyone can fill it, no login.
 *
 *  PLAYER mode (opened with ?as=player from the "Add a Turf" chooser)
 *    A player adds a turf they know. No owner details — only the player's
 *    name (pre-filled from their account) and the turf's phone number that
 *    players will call. Price is optional. Login required.
 *    FULLY IN-APP: no WhatsApp, and the player's phone is never asked —
 *    so nobody's number is shared with anyone.
 *
 * Photos (both modes): up to 5, shrunk and uploaded to Cloudinary as soon
 * as they're picked (utils/cloudinary.ts). Links saved in `images`.
 *
 * On submit:
 *   1. Saves to Firestore → turfRequests/{id} (status "pending",
 *      submittedAs "owner" | "player", images [...])
 *   2. Server push to every admin: POST /turf-request/notify-new
 *   3. Owner mode only: opens WhatsApp to PlayOn (98908 44206) as before
 *   4. Shows the success screen (same file) with the Request ID
 * The admin approves both kinds from app/admin/turf-requests.tsx.
 */
import { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, StatusBar,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Switch, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { collection, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { openWhatsApp } from "../../utils/whatsapp";
import { pickPhotos, takePhoto, uploadPhoto, cldThumb } from "../../utils/cloudinary";
import MapPickerModal from "../../components/Mappickermodal";

const GREEN = "#0E6B37";
const WA_GREEN = "#1FA855";
const INK = "#13221A";
const MUTED = "#5B6B61";
const PLAYON_WHATSAPP = "9890844206";
const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const MAX_PHOTOS = 5;

type Photo = { id: string; uri: string; url?: string; status: "uploading" | "done" | "error" };

// Same names as admin/add-turf.tsx so approved turfs show matching chips
const SPORTS = ["Football", "Cricket", "Pickleball", "Badminton", "Basketball", "Tennis", "Volleyball", "Kabaddi", "Hockey"];
const FACILITIES = [
  "Parking", "Bike Parking", "Washroom", "Changing Room", "Flood Lights", "Drinking Water",
  "Cafeteria", "First Aid", "Locker Room", "Seating Area", "WiFi", "CCTV", "Spectator Stand", "Equipment Rental",
];
const PLANS = [
  { key: "listing", title: "Turf Listing (Free)", sub: "Players call me to book" },
  { key: "online", title: "Turf Booking (Online)", sub: "Players book slots and pay in app" },
  { key: "unsure", title: "Not sure yet", sub: "PlayOn team will explain on call" },
] as const;
type PlanKey = (typeof PLANS)[number]["key"];

// Hours use the same numbers as add-turf: 0–23, and 25–28 = 1–4 AM next day
const OPEN_HOURS = Array.from({ length: 24 }, (_, i) => i);
const CLOSE_HOURS = Array.from({ length: 17 }, (_, i) => i + 12); // 12 PM → 4 AM
const hourLabel = (h: number) => {
  const hh = h % 24;
  const ampm = hh < 12 ? "AM" : "PM";
  const t = hh % 12 === 0 ? 12 : hh % 12;
  return `${t}:00 ${ampm}${h >= 24 ? " (next day)" : ""}`;
};

const onlyDigits = (v: string) => v.replace(/\D/g, "");
const validPhone = (v: string) => /^[6-9]\d{9}$/.test(onlyDigits(v).slice(-10));
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const makeCode = (id: string) => "TL-" + id.slice(-6).toUpperCase();

function Label({ text }: { text: string }) {
  return <Text style={s.label}>{text}</Text>;
}

function Chip({ text, on, onPress }: { text: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[s.chip, on && s.chipOn]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[s.chipTxt, on && s.chipTxtOn]}>{text}</Text>
    </TouchableOpacity>
  );
}

function HourPicker({ label, value, options, open, onToggle, onPick }: {
  label: string; value: number | null; options: number[]; open: boolean;
  onToggle: () => void; onPick: (h: number) => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Label text={label} />
      <TouchableOpacity style={s.select} onPress={onToggle} activeOpacity={0.8}>
        <Text style={[s.selectTxt, value == null && { color: "#9CA3AF" }]} numberOfLines={1}>
          {value == null ? "Select" : hourLabel(value)}
        </Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={MUTED} />
      </TouchableOpacity>
      {open && (
        <ScrollView style={s.hourList} nestedScrollEnabled>
          {options.map((h) => (
            <TouchableOpacity key={h} style={[s.hourItem, value === h && s.hourItemOn]} onPress={() => onPick(h)}>
              <Text style={[s.hourItemTxt, value === h && { color: "#fff" }]}>{hourLabel(h)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export default function ListTurf() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ as?: string }>();
  const isPlayer = params.as === "player";

  // Player (who is adding the turf) — pre-filled from the account
  const [reporterName, setReporterName] = useState("");
  // Turf's own phone (player mode) — the number players will call
  const [turfPhone, setTurfPhone] = useState("");

  useEffect(() => {
    if (!isPlayer) return;
    const u = auth.currentUser;
    if (!u) return;
    getDoc(doc(db, "users", u.uid))
      .then((snap) => {
        if (!snap.exists()) return;
        const d: any = snap.data();
        if (d.name) setReporterName((v) => v || String(d.name));
        if (d.city) setCity((v) => v || String(d.city));
        if (d.area) setArea((v) => v || String(d.area));
      })
      .catch(() => { /* pre-fill is optional */ });
  }, [isPlayer]);

  // Owner
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [waSame, setWaSame] = useState(true);
  const [waPhone, setWaPhone] = useState("");
  const [email, setEmail] = useState("");
  // Turf
  const [turfName, setTurfName] = useState("");
  const [state, setState] = useState("Maharashtra");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [showMap, setShowMap] = useState(false);
  // Sports / price / timings / facilities
  const [sports, setSports] = useState<string[]>([]);
  const [dayPrice, setDayPrice] = useState("");
  const [nightPrice, setNightPrice] = useState("");
  const [openHour, setOpenHour] = useState<number | null>(6);
  const [closeHour, setCloseHour] = useState<number | null>(23);
  const [picker, setPicker] = useState<"open" | "close" | null>(null);
  const [facilities, setFacilities] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanKey>("listing");

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ code: string; message: string } | null>(null);

  const toggle = (list: string[], set: (v: string[]) => void, item: string) =>
    set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  // ── Photos (Cloudinary) ─────────────────────────────────────────────────
  // Each photo uploads right after it's picked, so Submit is instant.
  const addPhotos = () => {
    const left = MAX_PHOTOS - photos.length;
    if (left <= 0) return Alert.alert("Photos", `You can add up to ${MAX_PHOTOS} photos.`);
    Alert.alert("Add turf photos", "Clear photos of the ground get approved faster.", [
      { text: "Cancel", style: "cancel" },
      { text: "Take photo", onPress: () => getPhotos("camera", 1) },
      { text: "Choose from gallery", onPress: () => getPhotos("gallery", left) },
    ]);
  };

  const getPhotos = async (from: "camera" | "gallery", max: number) => {
    try {
      const uris = from === "camera"
        ? [await takePhoto()].filter(Boolean) as string[]
        : await pickPhotos(max);
      if (!uris.length) return;
      const items: Photo[] = uris.map((uri, i) => ({ id: `${Date.now()}_${i}`, uri, status: "uploading" }));
      setPhotos((prev) => [...prev, ...items].slice(0, MAX_PHOTOS));
      items.forEach(startUpload);
    } catch (e: any) {
      if (e?.message === "PERMISSION") {
        Alert.alert("Permission needed", "Please allow photo access in your phone settings to add turf photos.");
      } else {
        Alert.alert("Couldn't open photos", "Please try again.");
      }
    }
  };

  const startUpload = async (item: Photo) => {
    setPhotos((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "uploading" } : p)));
    try {
      const url = await uploadPhoto(item.uri, isPlayer ? "turf-request-player" : "turf-request-owner");
      setPhotos((prev) => prev.map((p) => (p.id === item.id ? { ...p, url, status: "done" } : p)));
    } catch {
      setPhotos((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "error" } : p)));
    }
  };

  const removePhoto = (id: string) => setPhotos((prev) => prev.filter((p) => p.id !== id));

  const uploadedUrls = photos.filter((p) => p.status === "done" && p.url).map((p) => p.url!);
  const uploadingCount = photos.filter((p) => p.status === "uploading").length;
  const failedCount = photos.filter((p) => p.status === "error").length;

  const validate = (): string | null => {
    if (isPlayer) {
      if (!reporterName.trim()) return "Please enter your name.";
    } else {
      if (!ownerName.trim()) return "Please enter the owner name.";
      if (!validPhone(phone)) return "Please enter a valid 10-digit mobile number.";
      if (!waSame && !validPhone(waPhone)) return "Please enter a valid WhatsApp number.";
      if (!validEmail(email)) return "Please enter a valid email ID.";
    }
    if (!turfName.trim()) return "Please enter the turf name.";
    if (isPlayer && !validPhone(turfPhone)) return "Please enter the turf's 10-digit phone number (players will call it to book).";
    if (!state.trim()) return "Please enter the state.";
    if (!city.trim()) return "Please enter the city.";
    if (!area.trim()) return "Please enter the area / locality.";
    if (sports.length === 0) return "Select at least one sport.";
    // Price is required for owners, optional for players (admin fills it in)
    if (!isPlayer && !(Number(dayPrice) > 0)) return "Please enter the day price per hour.";
    if (isPlayer && dayPrice.trim() && !(Number(dayPrice) > 0)) return "Day price looks wrong.";
    if (nightPrice.trim() && !(Number(nightPrice) > 0)) return "Night price looks wrong.";
    if (openHour == null || closeHour == null) return "Please select opening and closing time.";
    if (closeHour <= openHour) return "Closing time must be after opening time.";
    if (closeHour > 24 && openHour < closeHour - 24) return "Opening time overlaps with late-night closing time.";
    if (uploadingCount > 0) return "Photos are still uploading. Please wait a moment.";
    return null;
  };

  // WhatsApp message — owner mode only
  const buildMessage = (code: string) => {
    const planTitle = PLANS.find((p) => p.key === plan)?.title || plan;
    const night = nightPrice.trim() ? ` · Night ₹${Number(nightPrice)}/hr` : "";
    return [
      "*New Turf Listing Request*",
      `Request ID: ${code}`,
      "",
      `Turf: ${turfName.trim()}`,
      `Owner: ${ownerName.trim()}`,
      `Phone: +91 ${onlyDigits(phone).slice(-10)}`,
      !waSame ? `WhatsApp: +91 ${onlyDigits(waPhone).slice(-10)}` : null,
      `Email: ${email.trim().toLowerCase()}`,
      `City: ${city.trim()}, ${state.trim()}`,
      `Area: ${area.trim()}`,
      address.trim() ? `Address: ${address.trim()}` : null,
      pin ? `Map: https://maps.google.com/?q=${pin.lat},${pin.lng}` : null,
      `Sports: ${sports.join(", ")}`,
      `Price: Day ₹${Number(dayPrice)}/hr${night}`,
      `Timings: ${hourLabel(openHour!)} – ${hourLabel(closeHour!)}`,
      facilities.length ? `Facilities: ${facilities.join(", ")}` : null,
      `Wants: ${planTitle}`,
      "",
      uploadedUrls.length
        ? `Photos: ${uploadedUrls.length} uploaded in the app`
        : "I will send turf photos here.",
    ].filter((l) => l !== null).join("\n");
  };

  // Tells the server → push notification to every admin. Never blocks the user.
  const notifyAdmins = async (requestId: string) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      fetch(`${SERVER_URL}/turf-request/notify-new`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId }),
      }).catch(() => {});
    } catch { /* silent — the request is already saved */ }
  };

  const submit = async () => {
    if (isPlayer && !auth.currentUser) {
      return Alert.alert("Login required", "Please log in to add a turf, so we know who added it.", [
        { text: "Cancel", style: "cancel" },
        { text: "Log In", onPress: () => router.push("/(auth)/login" as any) },
      ]);
    }
    const err = validate();
    if (err) return Alert.alert("Almost there", err);

    const go = async () => {
      try {
        setSaving(true);
        const ref = doc(collection(db, "turfRequests"));
        const code = makeCode(ref.id);
        const who = isPlayer
          ? {
              submittedAs: "player",
              // No owner yet — the turf's phone is the contact number.
              // The player's own phone is never asked or stored.
              ownerName: "",
              phone: onlyDigits(turfPhone).slice(-10),
              whatsappPhone: "",
              email: "",
              reporterName: reporterName.trim(),
              wants: "listing",
            }
          : {
              submittedAs: "owner",
              ownerName: ownerName.trim(),
              phone: onlyDigits(phone).slice(-10),
              whatsappPhone: waSame ? onlyDigits(phone).slice(-10) : onlyDigits(waPhone).slice(-10),
              email: email.trim().toLowerCase(),
              wants: plan,
            };
        await setDoc(ref, {
          requestCode: code,
          status: "pending",
          ...who,
          turfName: turfName.trim(),
          state: state.trim(),
          city: city.trim(),
          area: area.trim(),
          address: address.trim(),
          latitude: pin?.lat ?? null,
          longitude: pin?.lng ?? null,
          pinAddress: pin?.address ?? "",
          sports,
          // 0 = not known yet (player mode) — admin must fill it before approving
          dayPrice: Number(dayPrice) || Number(nightPrice) || 0,
          nightPrice: Number(nightPrice) || Number(dayPrice) || 0,
          openingTime: openHour,
          closingTime: closeHour,
          facilities,
          images: uploadedUrls,          // first one = cover
          submittedBy: auth.currentUser?.uid ?? null,
          createdAt: serverTimestamp(),
        });

        notifyAdmins(ref.id);

        if (isPlayer) {
          // Fully in-app: no WhatsApp, no phone numbers shared either way
          setDone({ code, message: "" });
          return;
        }
        const message = buildMessage(code);
        setDone({ code, message });
        const opened = await openWhatsApp(PLAYON_WHATSAPP, message);
        if (!opened) {
          Alert.alert("WhatsApp not opened", "Your request is saved. Please WhatsApp us at 98908 44206 with your Request ID " + code + ".");
        }
      } catch (e: any) {
        Alert.alert("Could not submit", e?.message || "Please check your internet and try again.");
      } finally {
        setSaving(false);
      }
    };

    if (failedCount > 0) {
      return Alert.alert(
        "Some photos didn't upload",
        `${failedCount} photo${failedCount > 1 ? "s" : ""} failed. Submit without ${failedCount > 1 ? "them" : "it"}, or go back and tap the photo to retry.`,
        [{ text: "Go back", style: "cancel" }, { text: "Submit anyway", onPress: go }],
      );
    }
    if (isPlayer && uploadedUrls.length === 0) {
      return Alert.alert(
        "No photos added",
        "Turfs with photos get approved faster. Submit without photos?",
        [{ text: "Add photos", style: "cancel", onPress: addPhotos }, { text: "Submit anyway", onPress: go }],
      );
    }
    go();
  };

  // ── Success screen ──────────────────────────────────────────────────────
  if (done && isPlayer) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <StatusBar barStyle="dark-content" backgroundColor="#F3F6F2" />
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}>
          <View style={s.doneTop}>
            <View style={s.doneIcon}><Ionicons name="checkmark" size={38} color="#fff" /></View>
            <Text style={s.doneTitle}>Sent for approval</Text>
            <Text style={s.doneSub}>
              Thanks for adding {turfName.trim() || "this turf"}! Our team will check it, usually within 24 hours.
              You'll get a notification when it's live.
            </Text>
            <View style={s.codePill}><Text style={s.codeTxt}>Request ID: {done.code}</Text></View>
          </View>

          <View style={s.stepsCard}>
            {[
              { t: "Details and photos received", on: true },
              { t: "PlayOn team checks the turf", on: false },
              { t: "It goes live for all players", on: false },
            ].map((st, i) => (
              <View key={i} style={s.stepRow}>
                <View style={[s.stepDot, st.on && s.stepDotOn]}>
                  {st.on
                    ? <Ionicons name="checkmark" size={14} color="#fff" />
                    : <Text style={s.stepNum}>{i + 1}</Text>}
                </View>
                <Text style={s.stepTxt}>{st.t}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={[s.cta, { backgroundColor: GREEN, marginTop: 22 }]} activeOpacity={0.88}
            onPress={() => router.replace("/(tabs)" as any)}>
            <Text style={s.ctaTxt}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} activeOpacity={0.85}
            onPress={() => router.replace({ pathname: "/list-turf", params: { as: "player" } } as any)}>
            <Text style={s.secondaryTxt}>Add another turf</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  if (done) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <StatusBar barStyle="dark-content" backgroundColor="#F3F6F2" />
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}>
          <View style={s.doneTop}>
            <View style={s.doneIcon}><Ionicons name="checkmark" size={38} color="#fff" /></View>
            <Text style={s.doneTitle}>Request received</Text>
            <Text style={s.doneSub}>
              {uploadedUrls.length
                ? "Send the message on WhatsApp so our team can review your turf. Your photos are already uploaded."
                : "Send the message on WhatsApp so our team can review your turf. We'll ask for photos there."}
            </Text>
            <View style={s.codePill}><Text style={s.codeTxt}>Request ID: {done.code}</Text></View>
          </View>

          <Text style={s.msgLabel}>MESSAGE TO PLAYON</Text>
          <View style={s.msgBubble}><Text style={s.msgTxt}>{done.message.replace(/\*/g, "")}</Text></View>

          <TouchableOpacity style={[s.cta, { backgroundColor: WA_GREEN, marginTop: 22 }]} activeOpacity={0.88}
            onPress={() => openWhatsApp(PLAYON_WHATSAPP, done.message)}>
            <Ionicons name="logo-whatsapp" size={20} color="#fff" />
            <Text style={s.ctaTxt}>Open WhatsApp again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={() => router.replace("/(tabs)" as any)} activeOpacity={0.85}>
            <Text style={s.secondaryTxt}>Back to home</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={GREEN} />
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isPlayer ? "Add a Turf" : "List Your Turf"}</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={s.info}>
            <Ionicons name="information-circle-outline" size={18} color="#1E4A2E" />
            <View style={{ flex: 1, gap: 4 }}>
              {isPlayer ? (
                <>
                  <Text style={s.infoTxt}>Know a turf that's not on PlayOn? Add it so other players can find it and call to book.</Text>
                  <Text style={[s.infoTxt, { fontWeight: "700" }]}>
                    Fill what you know — our team checks every turf before it goes live.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={s.infoTxt}>Free listing. No photos needed here — our team will ask for them on WhatsApp.</Text>
                  <Text style={[s.infoTxt, { fontWeight: "700" }]}>
                    Don't worry about exact details — you can update your turf timings and pricing anytime after approval.
                  </Text>
                </>
              )}
            </View>
          </View>

          {/* Player mode: who is adding this turf */}
          {isPlayer && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Your details</Text>
              <View>
                <Label text="Your name *" />
                <TextInput style={s.input} placeholder="Full name" placeholderTextColor="#9CA3AF"
                  value={reporterName} onChangeText={setReporterName} autoCapitalize="words" />
                <Text style={[s.hint, { marginTop: 6 }]}>
                  Only the PlayOn team sees this. We'll notify you in the app when the turf is live.
                </Text>
              </View>
            </View>
          )}

          {/* Photos (both modes) — upload to Cloudinary as soon as picked */}
          <View style={s.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
              <Text style={s.cardTitle}>Turf photos</Text>
              <Text style={s.hint}>{photos.length} of {MAX_PHOTOS}</Text>
            </View>
            <View style={s.photoGrid}>
              {photos.map((p, i) => (
                <TouchableOpacity
                  key={p.id}
                  style={s.photoTile}
                  activeOpacity={0.85}
                  disabled={p.status !== "error"}
                  onPress={() => startUpload(p)}
                  accessibilityLabel={p.status === "error" ? "Upload failed, tap to retry" : `Photo ${i + 1}`}
                >
                  <Image source={{ uri: p.url ? cldThumb(p.url, 300) : p.uri }} style={s.photoImg} />
                  {i === 0 && p.status === "done" && (
                    <View style={s.coverTag}><Text style={s.coverTxt}>COVER</Text></View>
                  )}
                  {p.status === "uploading" && (
                    <View style={s.photoOverlay}><ActivityIndicator color="#fff" /></View>
                  )}
                  {p.status === "error" && (
                    <View style={[s.photoOverlay, { backgroundColor: "rgba(180,35,24,0.75)" }]}>
                      <Ionicons name="refresh" size={20} color="#fff" />
                      <Text style={s.retryTxt}>Retry</Text>
                    </View>
                  )}
                  <TouchableOpacity style={s.photoX} onPress={() => removePhoto(p.id)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} accessibilityLabel="Remove photo">
                    <Ionicons name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
              {photos.length < MAX_PHOTOS && (
                <TouchableOpacity style={[s.photoTile, s.photoAdd]} onPress={addPhotos} activeOpacity={0.85}
                  accessibilityLabel="Add photo">
                  <Ionicons name="camera-outline" size={24} color={GREEN} />
                  <Text style={s.photoAddTxt}>Add photo</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={s.hint}>
              First photo is the cover. Clear photos of the ground get approved faster.
            </Text>
          </View>

          {/* Owner details (owner mode only) */}
          {!isPlayer && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Owner details</Text>
            <View>
              <Label text="Owner name *" />
              <TextInput style={s.input} placeholder="Full name" placeholderTextColor="#9CA3AF"
                value={ownerName} onChangeText={setOwnerName} autoCapitalize="words" />
            </View>
            <View>
              <Label text="Phone number *" />
              <View style={s.phoneWrap}>
                <Text style={s.prefix}>+91</Text>
                <TextInput style={s.phoneInput} placeholder="10-digit mobile" placeholderTextColor="#9CA3AF"
                  keyboardType="phone-pad" maxLength={10} value={phone} onChangeText={(v) => setPhone(onlyDigits(v))} />
              </View>
            </View>
            <View style={s.switchRow}>
              <Text style={s.switchTxt}>Same number on WhatsApp</Text>
              <Switch value={waSame} onValueChange={setWaSame} trackColor={{ false: "#D1D5DB", true: GREEN }} thumbColor="#fff" />
            </View>
            {!waSame && (
              <View>
                <Label text="WhatsApp number *" />
                <View style={s.phoneWrap}>
                  <Text style={s.prefix}>+91</Text>
                  <TextInput style={s.phoneInput} placeholder="10-digit WhatsApp" placeholderTextColor="#9CA3AF"
                    keyboardType="phone-pad" maxLength={10} value={waPhone} onChangeText={(v) => setWaPhone(onlyDigits(v))} />
                </View>
              </View>
            )}
            <View>
              <Label text="Email ID *" />
              <TextInput style={s.input} placeholder="you@example.com" placeholderTextColor="#9CA3AF"
                keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
            </View>
          </View>
          )}

          {/* Turf details */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Turf details</Text>
            <View>
              <Label text="Turf name *" />
              <TextInput style={s.input} placeholder="e.g. Green Arena Turf" placeholderTextColor="#9CA3AF"
                value={turfName} onChangeText={setTurfName} autoCapitalize="words" />
            </View>
            {isPlayer && (
              <View>
                <Label text="Turf's phone number *" />
                <View style={s.phoneWrap}>
                  <Text style={s.prefix}>+91</Text>
                  <TextInput style={s.phoneInput} placeholder="Number to call for booking" placeholderTextColor="#9CA3AF"
                    keyboardType="phone-pad" maxLength={10} value={turfPhone}
                    onChangeText={(v) => setTurfPhone(onlyDigits(v))} />
                </View>
                <Text style={[s.hint, { marginTop: 6 }]}>The turf's number, not yours — players will call it to book. Usually written at the turf gate.</Text>
              </View>
            )}
            <View style={s.row2}>
              <View style={{ flex: 1 }}>
                <Label text="State *" />
                <TextInput style={s.input} placeholder="State" placeholderTextColor="#9CA3AF"
                  value={state} onChangeText={setState} autoCapitalize="words" />
              </View>
              <View style={{ flex: 1 }}>
                <Label text="City *" />
                <TextInput style={s.input} placeholder="City" placeholderTextColor="#9CA3AF"
                  value={city} onChangeText={setCity} autoCapitalize="words" />
              </View>
            </View>
            <View>
              <Label text="Area / locality *" />
              <TextInput style={s.input} placeholder="e.g. Camp, Rajapeth" placeholderTextColor="#9CA3AF"
                value={area} onChangeText={setArea} autoCapitalize="words" />
            </View>
            <View>
              <Label text="Full address" />
              <TextInput style={[s.input, { height: 72, paddingTop: 12, textAlignVertical: "top" }]} multiline
                placeholder="Landmark, street" placeholderTextColor="#9CA3AF" value={address} onChangeText={setAddress} />
            </View>
            <TouchableOpacity style={[s.mapBtn, pin && s.mapBtnDone]} onPress={() => setShowMap(true)} activeOpacity={0.85}>
              <Ionicons name={pin ? "checkmark-circle" : "location-outline"} size={18} color={GREEN} />
              <Text style={s.mapBtnTxt} numberOfLines={1}>
                {pin ? "Location pinned — tap to change" : "Pin turf location on map"}
              </Text>
              {!pin && <Text style={s.optional}>(optional)</Text>}
            </TouchableOpacity>
            {!!pin?.address && <Text style={s.hint} numberOfLines={2}>{pin.address}</Text>}
          </View>

          {/* Sports */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Sports available *</Text>
            <View style={s.chipWrap}>
              {SPORTS.map((sp) => <Chip key={sp} text={sp} on={sports.includes(sp)} onPress={() => toggle(sports, setSports, sp)} />)}
            </View>
          </View>

          {/* Price & timings */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Price & timings</Text>
            {isPlayer && <Text style={[s.hint, { marginTop: -6 }]}>Price is optional — leave it empty if you're not sure.</Text>}
            <View style={s.row2}>
              <View style={{ flex: 1 }}>
                <Label text={isPlayer ? "Day price / hr" : "Day price / hr *"} />
                <TextInput style={s.input} placeholder="₹" placeholderTextColor="#9CA3AF" keyboardType="numeric"
                  value={dayPrice} onChangeText={(v) => setDayPrice(onlyDigits(v))} />
              </View>
              <View style={{ flex: 1 }}>
                <Label text="Night price / hr" />
                <TextInput style={s.input} placeholder="₹" placeholderTextColor="#9CA3AF" keyboardType="numeric"
                  value={nightPrice} onChangeText={(v) => setNightPrice(onlyDigits(v))} />
              </View>
            </View>
            <View style={s.row2}>
              <HourPicker label="Opens at *" value={openHour} options={OPEN_HOURS} open={picker === "open"}
                onToggle={() => setPicker(picker === "open" ? null : "open")}
                onPick={(h) => { setOpenHour(h); setPicker(null); }} />
              <HourPicker label="Closes at *" value={closeHour} options={CLOSE_HOURS} open={picker === "close"}
                onToggle={() => setPicker(picker === "close" ? null : "close")}
                onPick={(h) => { setCloseHour(h); setPicker(null); }} />
            </View>
          </View>

          {/* Facilities */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Facilities</Text>
            <View style={s.chipWrap}>
              {FACILITIES.map((f) => <Chip key={f} text={f} on={facilities.includes(f)} onPress={() => toggle(facilities, setFacilities, f)} />)}
            </View>
          </View>

          {/* Plan (owner mode only) */}
          {!isPlayer && (
          <View style={s.card}>
            <Text style={s.cardTitle}>What do you want?</Text>
            {PLANS.map((p) => {
              const on = plan === p.key;
              return (
                <TouchableOpacity key={p.key} style={[s.planBtn, on && s.planBtnOn]} onPress={() => setPlan(p.key)} activeOpacity={0.85}>
                  <View style={[s.radio, on && s.radioOn]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.planTitle}>{p.title}</Text>
                    <Text style={s.planSub}>{p.sub}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          )}

          <TouchableOpacity
            style={[s.cta, { backgroundColor: isPlayer ? GREEN : WA_GREEN }, (saving || uploadingCount > 0) && { opacity: 0.7 }]}
            onPress={submit} disabled={saving} activeOpacity={0.88}>
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                {!isPlayer && <Ionicons name="logo-whatsapp" size={20} color="#fff" />}
                <Text style={s.ctaTxt}>
                  {uploadingCount > 0
                    ? `Uploading ${uploadingCount} photo${uploadingCount > 1 ? "s" : ""}…`
                    : isPlayer ? "Submit for approval" : "Submit & send on WhatsApp"}
                </Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={[s.hint, { textAlign: "center", marginTop: -6 }]}>
            {isPlayer
              ? "Sent to the PlayOn team inside the app. No phone numbers are shared."
              : "Opens WhatsApp with your details to PlayOn (98908 44206)"}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <MapPickerModal
        visible={showMap}
        initialLat={pin?.lat}
        initialLng={pin?.lng}
        initialLocation={[area, city, state].filter((x) => x.trim()).join(", ")}
        onConfirm={(lat, lng, addr) => { setPin({ lat, lng, address: addr }); setShowMap(false); }}
        onClose={() => setShowMap(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F3F6F2" },
  header: { backgroundColor: GREEN, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingBottom: 12 },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#fff" },

  info: { flexDirection: "row", gap: 10, backgroundColor: "#E6F3E9", borderRadius: 12, padding: 12 },
  infoTxt: { fontSize: 13, lineHeight: 19, color: "#1E4A2E" },

  card: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 14, borderWidth: 1, borderColor: "#E2E8E3" },
  cardTitle: { fontSize: 15, fontWeight: "900", color: INK },
  label: { fontSize: 13, fontWeight: "700", color: INK, marginBottom: 6 },
  input: { height: 46, borderWidth: 1, borderColor: "#CBD5CE", borderRadius: 10, paddingHorizontal: 12, fontSize: 14, color: INK, backgroundColor: "#fff" },
  row2: { flexDirection: "row", gap: 10 },
  hint: { fontSize: 12, color: MUTED },

  phoneWrap: { flexDirection: "row", height: 46, borderWidth: 1, borderColor: "#CBD5CE", borderRadius: 10, overflow: "hidden" },
  prefix: { backgroundColor: "#F1F4F1", paddingHorizontal: 12, textAlignVertical: "center", lineHeight: 44, fontWeight: "700", color: "#3C4A41", fontSize: 14 },
  phoneInput: { flex: 1, paddingHorizontal: 12, fontSize: 14, color: INK },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 },
  switchTxt: { fontSize: 13, fontWeight: "600", color: INK },

  mapBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 10, borderWidth: 1.5, borderStyle: "dashed", borderColor: GREEN, backgroundColor: "#F4FAF5", paddingHorizontal: 12 },
  mapBtnDone: { borderStyle: "solid" },
  mapBtnTxt: { fontSize: 14, fontWeight: "700", color: GREEN, flexShrink: 1 },
  optional: { fontSize: 13, color: MUTED, fontWeight: "500" },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: "#CBD5CE", backgroundColor: "#fff", justifyContent: "center" },
  chipOn: { backgroundColor: GREEN, borderColor: GREEN },
  chipTxt: { fontSize: 13, fontWeight: "700", color: "#3C4A41" },
  chipTxtOn: { color: "#fff" },

  select: { height: 46, borderWidth: 1, borderColor: "#CBD5CE", borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  selectTxt: { fontSize: 13, color: INK, flex: 1 },
  hourList: { maxHeight: 200, marginTop: 6, borderWidth: 1, borderColor: "#E2E8E3", borderRadius: 10, backgroundColor: "#fff" },
  hourItem: { paddingVertical: 11, paddingHorizontal: 12 },
  hourItemOn: { backgroundColor: GREEN },
  hourItemTxt: { fontSize: 13, color: INK },

  planBtn: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, minHeight: 56, borderRadius: 12, borderWidth: 1, borderColor: "#CBD5CE" },
  planBtnOn: { borderWidth: 2, borderColor: GREEN, backgroundColor: "#F0F8F2" },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#9AA89F" },
  radioOn: { borderWidth: 6, borderColor: GREEN },
  planTitle: { fontSize: 14, fontWeight: "800", color: INK },
  planSub: { fontSize: 12, color: MUTED, marginTop: 2 },

  cta: { height: 54, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  ctaTxt: { color: "#fff", fontSize: 16, fontWeight: "900" },
  secondaryBtn: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: "#CBD5CE", backgroundColor: "#fff", alignItems: "center", justifyContent: "center", marginTop: 10 },
  secondaryTxt: { fontSize: 15, fontWeight: "700", color: INK },

  doneTop: { alignItems: "center", gap: 10, paddingTop: 24, paddingBottom: 16 },
  doneIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  doneTitle: { fontSize: 23, fontWeight: "900", color: INK },
  doneSub: { fontSize: 14, color: "#4C5C52", textAlign: "center", lineHeight: 21 },
  codePill: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#DCE4DE", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  codeTxt: { fontSize: 13, fontWeight: "800", color: INK },
  msgLabel: { fontSize: 12, fontWeight: "800", color: MUTED, letterSpacing: 0.5, marginBottom: 8 },
  msgBubble: { backgroundColor: "#E4F7D9", borderRadius: 14, borderBottomRightRadius: 4, padding: 14, borderWidth: 1, borderColor: "#CBE9B8" },
  msgTxt: { fontSize: 13, lineHeight: 20, color: INK },

  // Photos
  photoGrid:   { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoTile:   { width: "31.5%", aspectRatio: 1, borderRadius: 12, overflow: "hidden", backgroundColor: "#E5E7EB" },
  photoImg:    { width: "100%", height: "100%" },
  photoOverlay:{ ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", gap: 2 },
  retryTxt:    { color: "#fff", fontSize: 12, fontWeight: "800" },
  photoX:      { position: "absolute", top: 5, right: 5, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  coverTag:    { position: "absolute", left: 6, bottom: 6, backgroundColor: INK, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  coverTxt:    { color: "#fff", fontSize: 10, fontWeight: "900" },
  photoAdd:    { backgroundColor: "#F4FAF5", borderWidth: 1.5, borderStyle: "dashed", borderColor: GREEN, alignItems: "center", justifyContent: "center", gap: 4 },
  photoAddTxt: { fontSize: 12, fontWeight: "800", color: GREEN },

  // Player success steps
  stepsCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 14, borderWidth: 1, borderColor: "#E2E8E3" },
  stepRow:   { flexDirection: "row", alignItems: "center", gap: 10 },
  stepDot:   { width: 26, height: 26, borderRadius: 13, backgroundColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  stepDotOn: { backgroundColor: GREEN },
  stepNum:   { fontSize: 12, fontWeight: "900", color: "#374151" },
  stepTxt:   { fontSize: 14, fontWeight: "600", color: INK },
});
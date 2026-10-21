import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  useColorScheme,
  Linking,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState, useCallback } from "react";
import { auth, db } from "../../firebaseConfig";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useRouter, Stack, useFocusEffect } from "expo-router";
import { BackHandler } from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";

const VENUES = ["Cricket", "Football", "Badminton", "Pickleball", "Swimming", "Gym"];

// 🤝 Refer & Earn
const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

// Every new user gets their OWN code to share. Must match the generator
// in refer-and-earn.tsx exactly, or older accounts get a different code.
const makeReferralCode = (uid: string) => {
  const clean = uid.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return "PLAY" + (clean.slice(0, 3) + clean.slice(-3)).slice(0, 6);
};

const STEPS = [
  { name: "Your details",   title: "Create Account",     blurb: "Tell us who's booking — takes 30 seconds." },
  { name: "Where you play", title: "Where do you play?",  blurb: "This helps us show the closest turfs first." },
  { name: "Account",        title: "Secure your account", blurb: "Last step — your login details." },
];

// ── Signup colours ─────────────────────────────────────────────────────────
// Light = same as the app's LightTheme. Dark = fixed for this screen only:
// green buttons (was blue #0028dd), one dark-grey family for background /
// inputs / borders, and real grey hint text (was almost white).
const LIGHT = {
  background: "#FFFFFF",
  card:       "#F5F5F5",
  text:       "#111111",
  subText:    "#666666",
  border:     "#E5E5E5",
  primary:    "#00B14F", // links, progress bar, strength meter
  button:     "#00B14F", // filled buttons
  chipOnBg:   "#111111", // selected venue
  chipOnText: "#FFFFFF",
};
const DARK = {
  background: "#0F1115",
  card:       "#1A1D24",
  text:       "#F5F5F5",
  subText:    "#9CA3AF",
  border:     "#2A2F3A",
  primary:    "#22C55E",
  button:     "#16A34A",
  chipOnBg:   "#22C55E",
  chipOnText: "#06210F",
};
type SignupTheme = typeof LIGHT;

type Errors = Partial<Record<"name" | "phone" | "location" | "email" | "password", string>>;

export default function Signup() {
  const scheme = useColorScheme();
  const theme: SignupTheme = scheme === "dark" ? DARK : LIGHT;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [step, setStep] = useState(1);

  const [name,     setName]     = useState("");
  const [phone,    setPhone]    = useState("");
  const [location, setLocation] = useState("");
  const [venue,    setVenue]    = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [locating, setLocating] = useState(false);
  const [errors,   setErrors]   = useState<Errors>({});
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  // 🤝 Friend's referral code (optional)
  const [referralCode, setReferralCode] = useState("");

  const located = !!location && !!userCoords;

  // Hardware back → previous step, or back to login
  const goBack = useCallback(() => {
    setErrors({});
    setStep((p) => {
      if (p > 1) return p - 1;
      router.back();
      return p;
    });
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => { goBack(); return true; };
      const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
      return () => sub.remove();
    }, [goBack])
  );

  // Location is REQUIRED to finish signup (step 2 can't be skipped).
  const getLocation = async () => {
    setLocating(true);
    try {
      // Phone's GPS / location services switched off
      let servicesOn = await Location.hasServicesEnabledAsync();
      if (!servicesOn) {
        if (Platform.OS === "android") {
          // Android: show Google's built-in "Turn on location?" popup right
          // here in the app — user taps OK, no trip to Settings needed.
          try {
            await Location.enableNetworkProviderAsync();
          } catch {
            // User tapped "No thanks" on the popup
          }
          servicesOn = await Location.hasServicesEnabledAsync();
        }
        if (!servicesOn) {
          // iOS (no in-app popup exists) or Android user said no →
          // one tap takes them to Settings.
          Alert.alert(
            "Turn on location",
            "Your phone's location is off. Turn it on, then come back and tap Detect My Location.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open Settings",
                onPress: () => {
                  if (Platform.OS === "android") {
                    Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS").catch(() => Linking.openSettings());
                  } else {
                    Linking.openSettings();
                  }
                },
              },
            ]
          );
          return;
        }
      }

      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        // "Don't ask again" was chosen — the popup won't show any more, so
        // send them to the app's settings to allow it there.
        Alert.alert(
          "Location needed",
          "PlayOn needs your location to finish signup and show the turfs closest to you.",
          canAskAgain
            ? [{ text: "OK" }]
            : [
                { text: "Cancel", style: "cancel" },
                { text: "Open Settings", onPress: () => Linking.openSettings() },
              ]
        );
        return;
      }

      const loc = await Location.getCurrentPositionAsync({});
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };

      // City name is nice to have — if reverse geocoding fails we still have
      // the coordinates, so signup isn't blocked on it.
      let label = "";
      try {
        const address = await Location.reverseGeocodeAsync(loc.coords);
        if (address.length > 0) {
          const a = address[0];
          const city = a.city || a.subregion || "";
          label = [city, a.region].filter(Boolean).join(", ");
        }
      } catch {}

      setUserCoords(coords);
      setLocation(label || "Current location");
      setErrors((e) => ({ ...e, location: undefined }));
    } catch {
      Alert.alert("Error", "Failed to get location. Please try again.");
    } finally {
      setLocating(false);
    }
  };

  // password strength 0-4
  const strength = (() => {
    let n = 0;
    if (password.length >= 6)  n++;
    if (password.length >= 10) n++;
    if (/\d/.test(password))   n++;
    if (/[^A-Za-z0-9]/.test(password)) n++;
    return n;
  })();
  const strengthLabel = !password
    ? "Use 6+ characters with a number for a stronger password."
    : ["Too short", "Weak", "Fair", "Good", "Strong"][strength] + " password";

  const validate = (): Errors => {
    const e: Errors = {};
    if (step === 1) {
      if (!name.trim())  e.name  = "Please enter your full name.";
      if (!phone.trim()) e.phone = "Please enter your phone number.";
      else if (phone.replace(/\D/g, "").length < 10) e.phone = "Enter a valid 10-digit number.";
    }
    if (step === 2) {
      if (!located) e.location = "Please tap Detect My Location to continue.";
    }
    if (step === 3) {
      if (!email.trim()) e.email = "Please enter your email.";
      else if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = "Please enter a valid email address.";
      if (!password) e.password = "Please choose a password.";
      else if (password.length < 6) e.password = "Password must be at least 6 characters.";
    }
    return e;
  };

  const onNext = () => {
    const e = validate();
    if (Object.keys(e).length) return setErrors(e);
    setErrors({});
    if (step < 3) return setStep(step + 1);
    handleSignup();
  };

  const handleSignup = async () => {
    // Safety net — never create an account without a location.
    if (!userCoords) {
      setErrors({ location: "Please tap Detect My Location to continue." });
      setStep(2);
      return;
    }
    setLoading(true);
    try {
      const res  = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const user = res.user;

      await setDoc(doc(db, "users", user.uid), {
        name:          name.trim(),
        phone:         phone.trim(),
        location,
        latitude:      userCoords?.latitude  ?? null,
        longitude:     userCoords?.longitude ?? null,
        favoriteVenue: venue,
        email:         email.trim().toLowerCase(),
        role:          "user",
        referralCode:  makeReferralCode(user.uid),   // 🤝 their own code to share
        createdAt:     new Date(),
      });

      // ── 🤝 Apply a friend's referral code — never blocks signup ──────────
      let referralError = "";
      const enteredCode = referralCode.trim().toUpperCase();

      if (enteredCode) {
        try {
          const token = await user.getIdToken();
          const r = await fetch(`${SERVER_URL}/apply-referral-code`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization:  `Bearer ${token}`,
            },
            body: JSON.stringify({ code: enteredCode }),
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok || !data?.success) {
            referralError = data?.error || "We couldn't apply that referral code.";
          }
        } catch {
          referralError = "We couldn't reach the server to apply that code.";
        }
      }

      if (referralError) {
        Alert.alert(
          "Referral code not applied",
          `${referralError}\n\nYour account is ready — you can still book and earn coins.`,
          [{ text: "Continue", onPress: () => router.replace("/(tabs)") }],
          { cancelable: false }
        );
      } else {
        router.replace("/(tabs)");
      }
    } catch (error: any) {
      const code = error?.code || "";
      if      (code === "auth/email-already-in-use") Alert.alert("Account Exists", "An account with this email already exists. Please login instead.");
      else if (code === "auth/invalid-email")        Alert.alert("Invalid Email", "Please enter a valid email address.");
      else if (code === "auth/weak-password")        Alert.alert("Weak Password", "Password must be at least 6 characters.");
      else if (code === "auth/network-request-failed") Alert.alert("Network Error", "Please check your connection and try again.");
      else                                           Alert.alert("Signup Failed", error?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const s = makeStyles(theme);
  const meta = STEPS[step - 1];

  return (
    <>
      <Stack.Screen
        options={{
          title: "Create Account",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      <KeyboardAvoidingView
        style={s.kav}
        behavior="padding"
      >
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, { paddingTop: insets.top + 20 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.title}>{meta.title}</Text>
          <Text style={s.subtitle}>{meta.blurb}</Text>

          {step === 1 && (
            <>
              <Text style={s.label}>Full Name *</Text>
              <TextInput
                style={[s.input, !!errors.name && s.inputError]}
                placeholder="Enter your full name"
                placeholderTextColor={theme.subText}
                value={name}
                onChangeText={(t) => { setName(t); setErrors({}); }}
                autoCapitalize="words"
                returnKeyType="next"
              />
              {!!errors.name && <Text style={s.error}>{errors.name}</Text>}

              <Text style={s.label}>Phone Number *</Text>
              <TextInput
                style={[s.input, !!errors.phone && s.inputError]}
                placeholder="+91 XXXXX XXXXX"
                placeholderTextColor={theme.subText}
                value={phone}
                onChangeText={(t) => { setPhone(t); setErrors({}); }}
                keyboardType="phone-pad"
                returnKeyType="next"
              />
              {!!errors.phone && <Text style={s.error}>{errors.phone}</Text>}
              <Text style={s.hint}>Used by turf owners to confirm your booking.</Text>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={s.label}>City *</Text>
              {located ? (
                <View style={s.locCard}>
                  <View style={s.locLeft}>
                    <Ionicons name="location" size={18} color={theme.primary} />
                    <View>
                      <Text style={s.locCity}>{location}</Text>
                      <Text style={s.locTag}>Detected</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => { setLocation(""); setUserCoords(null); }}
                    style={s.changeBtn}
                    activeOpacity={0.7}
                  >
                    <Text style={s.changeTxt}>Change</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[s.locationBtn, !!errors.location && s.locationBtnError]}
                  onPress={getLocation}
                  disabled={locating}
                  activeOpacity={0.85}
                >
                  {locating
                    ? <ActivityIndicator color="#fff" />
                    : (
                      <>
                        <Ionicons name="location-outline" size={16} color="#FFFFFF" />
                        <Text style={s.locationBtnText}>Detect My Location</Text>
                      </>
                    )}
                </TouchableOpacity>
              )}
              {!!errors.location && <Text style={s.error}>{errors.location}</Text>}
              <Text style={s.hint}>Required — we use this only to sort turfs by distance.</Text>

              <Text style={s.label}>Favorite Venue</Text>
              <View style={s.venueGrid}>
                {VENUES.map((item) => {
                  const active = venue === item;
                  return (
                    <TouchableOpacity
                      key={item}
                      style={[s.venueBtn, active && s.venueBtnActive]}
                      onPress={() => setVenue(item)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.venueTxt, active && s.venueTxtActive]}>{item}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={s.hint}>Optional — you can change it later in your profile.</Text>

              {/* ── 🤝 Referral code ─────────────────────────────────────── */}
              <Text style={s.label}>Referral Code</Text>
              <View style={s.refWrap}>
                <Ionicons name="gift-outline" size={18} color={theme.subText} />
                <TextInput
                  style={s.refInput}
                  placeholder="PLAYXXXXXX"
                  placeholderTextColor={theme.subText}
                  value={referralCode}
                  onChangeText={(t) => setReferralCode(t.toUpperCase().replace(/\s/g, ""))}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                  returnKeyType="done"
                />
                {!!referralCode && (
                  <TouchableOpacity onPress={() => setReferralCode("")} style={s.refClear} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={theme.subText} />
                  </TouchableOpacity>
                )}
              </View>
              <Text style={s.hint}>
                Optional — got a code from a friend? Enter it here so they earn coins
                after your first booking.
              </Text>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={s.label}>Email *</Text>
              <TextInput
                style={[s.input, !!errors.email && s.inputError]}
                placeholder="you@email.com"
                placeholderTextColor={theme.subText}
                value={email}
                onChangeText={(t) => { setEmail(t); setErrors({}); }}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
              />
              {!!errors.email && <Text style={s.error}>{errors.email}</Text>}

              <Text style={s.label}>Password *</Text>
              <View style={[s.pwWrap, !!errors.password && s.inputError]}>
                <TextInput
                  style={s.pwInput}
                  placeholder="Min. 6 characters"
                  placeholderTextColor={theme.subText}
                  value={password}
                  onChangeText={(t) => { setPassword(t); setErrors({}); }}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  returnKeyType="done"
                />
                <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPw((p) => !p)}>
                  <Ionicons name={showPw ? "eye-off-outline" : "eye-outline"} size={20} color={theme.subText} />
                </TouchableOpacity>
              </View>
              <View style={s.meter}>
                {[1, 2, 3, 4].map((i) => (
                  <View key={i} style={[s.meterCell, i <= strength && s.meterCellOn]} />
                ))}
              </View>
              <Text style={s.hint}>{strengthLabel}</Text>
              {!!errors.password && <Text style={s.error}>{errors.password}</Text>}

              <View style={s.review}>
                <Text style={s.reviewHead}>Review your details</Text>
                {[
                  ["Name",  name     || "—"],
                  ["Phone", phone    || "—"],
                  ["City",  location || "Not set"],
                  ["Venue", venue    || "Not set"],
                  ...(referralCode.trim()
                    ? [["Referral", referralCode.trim().toUpperCase()]]
                    : []),
                ].map(([k, v]) => (
                  <View key={k} style={s.reviewRow}>
                    <Text style={s.reviewKey}>{k}</Text>
                    <Text style={s.reviewVal}>{v}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>

        {/* Footer actions */}
        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          {/* Step progress — above the buttons, clear of the status bar */}
          <View style={s.progressWrap}>
            <View style={s.progressRow}>
              <Text style={s.stepName}>{meta.name}</Text>
              <Text style={s.stepCount}>{`Step ${step} of 3`}</Text>
            </View>
            <View style={s.cells}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={[s.cell, i <= step && s.cellOn]} />
              ))}
            </View>
          </View>

          <View style={s.footerRow}>
            {step > 1 && (
              <TouchableOpacity style={s.backBtn} onPress={goBack} activeOpacity={0.8}>
                <Ionicons name="arrow-back" size={20} color={theme.text} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.btn, loading && { opacity: 0.65 }]}
              onPress={onNext}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnText}>{step === 3 ? "Create Account" : "Continue"}</Text>}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.loginWrap} onPress={() => router.push("/(auth)/login")} activeOpacity={0.7}>
            <Text style={s.loginText}>Already have an account? </Text>
            <Text style={[s.loginText, { color: theme.primary, fontWeight: "700" }]}>Login</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const makeStyles = (theme: SignupTheme) =>
  StyleSheet.create({
    kav:     { flex: 1, backgroundColor: theme.background },
    scroll:  { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: 24, paddingTop: 20 },

    // Step progress
    progressWrap: { paddingBottom: 14 },
    progressRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    stepName:     { fontSize: 13, fontWeight: "700", color: theme.text, textTransform: "uppercase", letterSpacing: 0.4 },
    stepCount:    { fontSize: 13, fontWeight: "600", color: theme.subText },
    cells:        { flexDirection: "row", gap: 6 },
    cell:         { flex: 1, height: 5, borderRadius: 4, backgroundColor: theme.border },
    cellOn:       { backgroundColor: theme.primary },

    title:    { fontSize: 28, fontWeight: "800", color: theme.text, marginBottom: 6 },
    subtitle: { fontSize: 14, color: theme.subText, marginBottom: 6, fontWeight: "500" },

    label: {
      fontSize: 13, fontWeight: "700", color: theme.text,
      marginBottom: 6, marginTop: 16,
      textTransform: "uppercase", letterSpacing: 0.4,
    },
    hint:  { fontSize: 12, color: theme.subText, marginTop: 8 },
    error: { fontSize: 12.5, fontWeight: "600", color: "#E5484D", marginTop: 6 },

    input: {
      backgroundColor: theme.card,
      color:           theme.text,
      padding:         14,
      borderRadius:    12,
      fontSize:        15,
      borderWidth:     1,
      borderColor:     theme.border,
    },
    inputError: { borderColor: "#E5484D" },

    // 🤝 Referral code input
    refWrap: {
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: theme.card, borderRadius: 12,
      borderWidth: 1.5, borderColor: theme.border, borderStyle: "dashed",
      paddingHorizontal: 14,
    },
    refInput: {
      flex: 1, paddingVertical: 14, fontSize: 15,
      color: theme.text, fontWeight: "700", letterSpacing: 1.5,
    },
    refClear: { padding: 4 },

    // Location
    locationBtn: {
      backgroundColor: theme.button,
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, padding: 14, borderRadius: 12,
    },
    locationBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
    locationBtnError: { borderWidth: 2, borderColor: "#E5484D" },

    locCard: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border,
      paddingVertical: 12, paddingLeft: 14, paddingRight: 8,
    },
    locLeft:   { flexDirection: "row", alignItems: "center", gap: 10 },
    locCity:   { fontSize: 15, fontWeight: "700", color: theme.text },
    locTag:    { fontSize: 12, color: theme.subText, marginTop: 1 },
    changeBtn: { paddingVertical: 10, paddingHorizontal: 12 },
    changeTxt: { color: theme.primary, fontWeight: "700", fontSize: 14 },

    // Venue chips
    venueGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    venueBtn: {
      width: "31%", minHeight: 48, alignItems: "center", justifyContent: "center",
      borderRadius: 10, backgroundColor: theme.card,
      borderWidth: 1, borderColor: theme.border, paddingHorizontal: 4,
    },
    venueBtnActive: { backgroundColor: theme.chipOnBg, borderColor: theme.chipOnBg },
    venueTxt:       { color: theme.text, fontWeight: "600", fontSize: 13 },
    venueTxtActive: { color: theme.chipOnText, fontWeight: "700" },

    // Password
    pwWrap: {
      flexDirection: "row", alignItems: "center",
      backgroundColor: theme.card, borderRadius: 12,
      borderWidth: 1, borderColor: theme.border, paddingRight: 8,
    },
    pwInput: { flex: 1, padding: 14, fontSize: 15, color: theme.text },
    eyeBtn:  { padding: 8 },

    meter:       { flexDirection: "row", gap: 6, marginTop: 10 },
    meterCell:   { flex: 1, height: 4, borderRadius: 3, backgroundColor: theme.border },
    meterCellOn: { backgroundColor: theme.primary },

    // Review
    review:     { marginTop: 24, backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 14 },
    reviewHead: { fontSize: 13, fontWeight: "700", color: theme.text, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 },
    reviewRow:  { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7 },
    reviewKey:  { fontSize: 14, color: theme.subText },
    reviewVal:  { fontSize: 14, fontWeight: "600", color: theme.text },

    // Footer
    footer:    { paddingHorizontal: 24, paddingTop: 12, backgroundColor: theme.background },
    footerRow: { flexDirection: "row", gap: 10 },
    backBtn: {
      width: 54, height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center",
      backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    },
    btn: {
      flex: 1, backgroundColor: theme.button,
      height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center",
    },
    btnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },

    loginWrap: { flexDirection: "row", justifyContent: "center", marginTop: 18 },
    loginText: { fontSize: 14, color: theme.subText },
  });
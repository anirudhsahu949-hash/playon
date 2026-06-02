import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useState } from "react";
import { auth, db } from "../../firebaseConfig";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useRouter, Stack } from "expo-router";
import * as Location from "expo-location";
import { useAppTheme } from "../../theme/themeprovider";
import { Ionicons } from "@expo/vector-icons";

export default function Signup() {
  const theme  = useAppTheme();
  const router = useRouter();

  const [name,     setName]     = useState("");
  const [phone,    setPhone]    = useState("");
  const [location, setLocation] = useState("");
  const [sport,    setSport]    = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [locating, setLocating] = useState(false);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const getLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "Location permission is required to detect your city.");
        return;
      }
      const loc     = await Location.getCurrentPositionAsync({});

      // ✅ Save raw coords — this is the key data for nearby turf sorting later
      setUserCoords({
        latitude:  loc.coords.latitude,
        longitude: loc.coords.longitude,
      });

      const address = await Location.reverseGeocodeAsync(loc.coords);
      if (address.length > 0) {
        const a     = address[0];
        const city  = a.city || a.subregion || "";
        const place = [city, a.region].filter(Boolean).join(", ");
        setLocation(place);
      }
    } catch {
      Alert.alert("Error", "Failed to get location. Please try again.");
    } finally {
      setLocating(false);
    }
  };

  const handleSignup = async () => {
    if (!name.trim())  return Alert.alert("Required", "Please enter your full name.");
    if (!phone.trim()) return Alert.alert("Required", "Please enter your phone number.");
    if (!email.trim()) return Alert.alert("Required", "Please enter your email.");
    if (!password)     return Alert.alert("Required", "Please enter a password.");

    setLoading(true);
    try {
      const res  = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const user = res.user;
      await setDoc(doc(db, "users", user.uid), {
        name:          name.trim(),
        phone:         phone.trim(),
        location:      location,
        // ✅ Save coordinates so home screen can sort turfs by real distance
        latitude:      userCoords?.latitude  ?? null,
        longitude:     userCoords?.longitude ?? null,
        favoriteSport: sport,
        email:         email.trim().toLowerCase(),
        role:          "user",
        createdAt:     new Date(),
      });
      router.replace("/(tabs)");
    } catch (error: any) {
      const code = error?.code || "";
      if      (code === "auth/email-already-in-use") Alert.alert("Account Exists", "An account with this email already exists. Please login instead.");
      else if (code === "auth/invalid-email")        Alert.alert("Invalid Email", "Please enter a valid email address.");
      else if (code === "auth/weak-password")        Alert.alert("Weak Password", "Password must be at least 6 characters.");
      else                                           Alert.alert("Signup Failed", error?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const s = makeStyles(theme);

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
        behavior={Platform.OS === "ios" ? "padding" : "padding"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Text style={s.title}>Create Account</Text>
          <Text style={s.subtitle}>Join Playon and start booking turfs</Text>

          <Text style={s.label}>Full Name *</Text>
          <TextInput
            style={s.input}
            placeholder="Enter your full name"
            placeholderTextColor={theme.subText}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            returnKeyType="next"
          />

          <Text style={s.label}>Phone Number *</Text>
          <TextInput
            style={s.input}
            placeholder="+91 XXXXX XXXXX"
            placeholderTextColor={theme.subText}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            returnKeyType="next"
          />

          <Text style={s.label}>Location</Text>
          <TouchableOpacity style={s.locationBtn} onPress={getLocation} disabled={locating} activeOpacity={0.8}>
            <Ionicons name="location-outline" size={16} color="#FFFFFF" />
            <Text style={s.locationBtnText}>
              {locating ? "Detecting..." : location ? location : "Detect My Location"}
            </Text>
          </TouchableOpacity>

          <Text style={s.label}>Favourite Sport</Text>
          <View style={s.sportRow}>
            {["Cricket", "Football", "Other"].map((item) => {
              const active = sport === item;
              return (
                <TouchableOpacity
                  key={item}
                  style={[s.sportBtn, active && s.sportBtnActive]}
                  onPress={() => setSport(item)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.sportBtnText, active && s.sportBtnTextActive]}>{item}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={s.label}>Email *</Text>
          <TextInput
            style={s.input}
            placeholder="you@email.com"
            placeholderTextColor={theme.subText}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
          />

          <Text style={s.label}>Password *</Text>
          <View style={s.pwWrap}>
            <TextInput
              style={s.pwInput}
              placeholder="Min. 6 characters"
              placeholderTextColor={theme.subText}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              returnKeyType="done"
            />
            <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPw((p) => !p)}>
              <Ionicons name={showPw ? "eye-off-outline" : "eye-outline"} size={20} color={theme.subText} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.loginLink} onPress={() => router.push("/login")} activeOpacity={0.7}>
            <Text style={s.loginLinkText}>Already have an account? </Text>
            <Text style={[s.loginLinkText, { color: theme.primary, fontWeight: "700" }]}>Login</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.btn, loading && { opacity: 0.6 }]}
            onPress={handleSignup}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={s.btnText}>{loading ? "Creating account..." : "Sign Up"}</Text>
          </TouchableOpacity>

          <View style={{ height: 48 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const makeStyles = (theme: ReturnType<typeof import("../../theme/themeprovider").useAppTheme>) =>
  StyleSheet.create({
    kav:    { flex: 1, backgroundColor: theme.background },
    scroll: { flex: 1, backgroundColor: theme.background },
    content:{ padding: 24, paddingTop: Platform.OS === "android" ? 16 : 8 },

    title:    { fontSize: 28, fontWeight: "800", color: theme.text, marginBottom: 2, marginTop: 25 },
    subtitle: { fontSize: 14, color: theme.subText, marginBottom: 10, fontWeight: "500" },

    label: {
      fontSize: 13, fontWeight: "700", color: theme.text,
      marginBottom: 6, marginTop: 16,
      textTransform: "uppercase", letterSpacing: 0.4,
    },

    input: {
      backgroundColor: theme.card,
      color:           theme.text,
      padding:         14,
      borderRadius:    12,
      fontSize:        15,
      borderWidth:     1,
      borderColor:     theme.border,
    },

    locationBtn: {
      backgroundColor: "#007AFF",
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, padding: 14, borderRadius: 12,
    },
    locationBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },

    sportRow: { flexDirection: "row", gap: 10 },
    sportBtn: {
      flex: 1, padding: 12, borderRadius: 10, alignItems: "center",
      backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    },
    sportBtnActive:     { backgroundColor: theme.text, borderColor: theme.text },
    sportBtnText:       { color: theme.text, fontWeight: "600", fontSize: 13 },
    sportBtnTextActive: { color: theme.background, fontWeight: "700" },

    pwWrap: {
      flexDirection: "row", alignItems: "center",
      backgroundColor: theme.card, borderRadius: 12,
      borderWidth: 1, borderColor: theme.border, paddingRight: 8,
    },
    pwInput: { flex: 1, padding: 14, fontSize: 15, color: theme.text },
    eyeBtn:  { padding: 8 },

    loginLink:     { flexDirection: "row", justifyContent: "center", marginTop: 20 },
    loginLinkText: { fontSize: 14, color: theme.subText },

    btn: {
      backgroundColor: theme.primary,
      padding: 16, borderRadius: 14, alignItems: "center", marginTop: 24,
    },
    btnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  });
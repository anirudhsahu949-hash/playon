import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useState } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "expo-router";
import { useAppTheme } from "../../theme/themeprovider";
import { Ionicons } from "@expo/vector-icons";
import {  collection, getDocs, query, where } from "firebase/firestore";

export default function Login() {
  const router = useRouter();
  const theme  = useAppTheme();

  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [loading,      setLoading]      = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // ── Error messages ─────────────────────────────────────────────────────────
  const getErrorMessage = (error: any): string => {
    const code = error?.code || "";
    switch (code) {
      case "auth/user-not-found":       return "No account found with this email. Please sign up.";
      case "auth/wrong-password":       return "Incorrect password. Please try again.";
      case "auth/invalid-email":        return "Please enter a valid email address.";
      case "auth/too-many-requests":    return "Too many failed attempts. Please try again later.";
      case "auth/network-request-failed": return "Network error. Please check your connection.";
      case "auth/invalid-credential":   return "Wrong email or password. Please try again.";
      default:                          return error?.message || "Something went wrong. Please try again.";
    }
  };

  // ── Login ──────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!email.trim())  return Alert.alert("Required", "Please enter your email.");
    if (!password)      return Alert.alert("Required", "Please enter your password.");

    setLoading(true);
    try {
      const userCred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const snap     = await getDoc(doc(db, "users", userCred.user.uid));

      if (!snap.exists()) {
        Alert.alert("Error", "User data not found. Please contact support.");
        await signOut(auth);
        return;
      }

      const data = snap.data();

      // Blocked account check
      if (data.status === "blocked" || data.status === "inactive") {
        await signOut(auth);
        Alert.alert("Account Disabled", "Your account has been disabled. Please contact support.");
        return;
      }

      // Role-based routing
    
const role = data.role;
if (role === "admin") {
  router.replace("/admin");
} else if (role === "owner") {
  // Venue-aware: a gym-only owner goes straight to the gym dashboard
  const uid = userCred.user.uid;
  const [gymSnap, turfSnap] = await Promise.all([
    getDocs(query(collection(db, "gyms"),  where("ownerId", "==", uid))),
    getDocs(query(collection(db, "turfs"), where("ownerId", "==", uid))),
  ]);
  if (!gymSnap.empty && turfSnap.empty) {
    router.replace("/(owner)/owner-gym");   // gym only → gym dashboard
  } else {
    router.replace("/(owner)");     // turf only, or both → turf home
  }
} else if (role === "operator" || role === "turf-operator") {
  router.replace("/(turf-operator)");
} else {
  router.replace("/(tabs)");
}

    } catch (error: any) {
      Alert.alert("Login Failed", getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password ────────────────────────────────────────────────────────
  const handleForgotPassword = async () => {
    if (!email.trim()) return Alert.alert("Enter Email", "Please enter your email address first.");
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      Alert.alert("Email Sent ✅", "A password reset link has been sent to your email.");
    } catch (error: any) {
      Alert.alert("Error", getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const s = makeStyles(theme);

  return (
    <View style={s.container}>
      {/* Title */}
      <Text style={s.title}>Welcome Back 👋</Text>
      <Text style={s.subtitle}>Sign in to continue</Text>

      {/* Email */}
      <Text style={s.label}>Email</Text>
      <TextInput
        style={s.input}
        placeholder="you@email.com"
        placeholderTextColor={theme.subText}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      {/* Password */}
      <Text style={s.label}>Password</Text>
      <View style={s.pwWrap}>
        <TextInput
          style={s.pwInput}
          placeholder="Enter your password"
          placeholderTextColor={theme.subText}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
        />
        <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPassword((p) => !p)}>
          <Ionicons
            name={showPassword ? "eye-off-outline" : "eye-outline"}
            size={20}
            color={theme.subText}
          />
        </TouchableOpacity>
      </View>

      {/* Forgot password */}
      <TouchableOpacity onPress={handleForgotPassword} style={s.forgotWrap} activeOpacity={0.7}>
        <Text style={s.forgotText}>Forgot Password?</Text>
      </TouchableOpacity>

      {/* Login button */}
      <TouchableOpacity
        style={[s.btn, loading && { opacity: 0.65 }]}
        onPress={handleLogin}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.btnText}>Login</Text>
        }
      </TouchableOpacity>

      {/* Sign up link */}
      <TouchableOpacity
        style={s.signupWrap}
        onPress={() => router.push("/(auth)/signup")}
        activeOpacity={0.7}
      >
        <Text style={s.signupText}>Don't have an account? </Text>
        <Text style={[s.signupText, { color: theme.primary, fontWeight: "700" }]}>Sign Up</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Theme-aware styles ────────────────────────────────────────────────────────
const makeStyles = (theme: ReturnType<typeof import("../../theme/themeprovider").useAppTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent:  "center",
      padding:         24,
      backgroundColor: theme.background,
    },

    title:    { fontSize: 28, fontWeight: "800", color: theme.text, marginBottom: 6 },
    subtitle: { fontSize: 14, color: theme.subText, marginBottom: 28, fontWeight: "500" },

    label: {
      fontSize:        13,
      fontWeight:      "700",
      color:           theme.text,
      marginBottom:    6,
      marginTop:       14,
      textTransform:   "uppercase",
      letterSpacing:   0.4,
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

    // Password row
    pwWrap: {
      flexDirection:   "row",
      alignItems:      "center",
      backgroundColor: theme.card,
      borderRadius:    12,
      borderWidth:     1,
      borderColor:     theme.border,
      paddingRight:    8,
    },
    pwInput: {
      flex:      1,
      padding:   14,
      fontSize:  15,
      color:     theme.text,
    },
    eyeBtn: { padding: 8 },

    forgotWrap: { alignSelf: "flex-end", marginTop: 10, marginBottom: 4 },
    forgotText: { color: theme.primary, fontSize: 14, fontWeight: "600" },

    btn: {
      backgroundColor: theme.primary,
      padding:         16,
      borderRadius:    14,
      alignItems:      "center",
      marginTop:       20,
    },
    btnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },

    signupWrap: { flexDirection: "row", justifyContent: "center", marginTop: 20 },
    signupText: { fontSize: 14, color: theme.subText },
  })
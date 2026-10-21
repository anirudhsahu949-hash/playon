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
} from "react-native";
import { useState, useCallback } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter, Stack, useFocusEffect } from "expo-router";
import { BackHandler } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ── Login colours — same as signup.tsx so both screens match ───────────────
const LIGHT = {
  background: "#FFFFFF",
  card:       "#F5F5F5",
  text:       "#111111",
  subText:    "#666666",
  border:     "#E5E5E5",
  primary:    "#00B14F", // links
  button:     "#00B14F", // filled buttons
};
const DARK = {
  background: "#0F1115",
  card:       "#1A1D24",
  text:       "#F5F5F5",
  subText:    "#9CA3AF",
  border:     "#2A2F3A",
  primary:    "#22C55E",
  button:     "#16A34A",
};
type LoginTheme = typeof LIGHT;

type Errors = Partial<Record<"email" | "password" | "form", string>>;

export default function Login() {
  const scheme = useColorScheme();
  const theme: LoginTheme = scheme === "dark" ? DARK : LIGHT;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [loading,      setLoading]      = useState(false);
  const [resetting,    setResetting]    = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors,       setErrors]       = useState<Errors>({});

  const goToTabs = useCallback(() => {
    router.replace("/(tabs)");
  }, [router]);

  // ── Hardware back (Android) → Home tab instead of exiting the app ──
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => { goToTabs(); return true; };
      const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
      return () => sub.remove();
    }, [goToTabs])
  );

  // ── Error messages ─────────────────────────────────────────────────────────
  const getErrorMessage = (error: any): string => {
    const code = error?.code || "";
    switch (code) {
      case "auth/user-not-found":         return "No account found with this email. Please sign up.";
      case "auth/wrong-password":         return "Incorrect password. Please try again.";
      case "auth/invalid-email":          return "Please enter a valid email address.";
      case "auth/too-many-requests":      return "Too many failed attempts. Please try again later.";
      case "auth/network-request-failed": return "Network error. Please check your connection.";
      case "auth/invalid-credential":     return "Wrong email or password. Please try again.";
      default:                            return error?.message || "Something went wrong. Please try again.";
    }
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (!email.trim()) e.email = "Please enter your email.";
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = "Please enter a valid email address.";
    if (!password) e.password = "Please enter your password.";
    return e;
  };

  // ── Login ──────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    const e = validate();
    if (Object.keys(e).length) return setErrors(e);
    setErrors({});

    setLoading(true);
    try {
      const userCred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const snap     = await getDoc(doc(db, "users", userCred.user.uid));

      if (!snap.exists()) {
        await signOut(auth);
        Alert.alert("Error", "User data not found. Please contact support.");
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
        router.replace("/(owner)");
      } else if (role === "operator" || role === "turf-operator") {
        router.replace("/(turf-operator)");
      } else {
        router.replace("/(tabs)");
      }
    } catch (error: any) {
      setErrors({ form: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password ────────────────────────────────────────────────────────
  const handleForgotPassword = async () => {
    if (!email.trim()) {
      return setErrors({ email: "Enter your email above, then tap Forgot Password." });
    }
    setResetting(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setErrors({});
      Alert.alert("Email Sent ✅", "A password reset link has been sent to your email.");
    } catch (error: any) {
      setErrors({ email: getErrorMessage(error) });
    } finally {
      setResetting(false);
    }
  };

  const s = makeStyles(theme);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Login",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      <KeyboardAvoidingView style={s.kav} behavior="padding">
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, { paddingTop: insets.top + 20 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.title}>Welcome back</Text>
          <Text style={s.subtitle}>Log in to book your next game.</Text>

          {/* Email */}
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

          {/* Password */}
          <Text style={s.label}>Password *</Text>
          <View style={[s.pwWrap, !!errors.password && s.inputError]}>
            <TextInput
              style={s.pwInput}
              placeholder="Enter your password"
              placeholderTextColor={theme.subText}
              value={password}
              onChangeText={(t) => { setPassword(t); setErrors({}); }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPassword((p) => !p)}>
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={theme.subText} />
            </TouchableOpacity>
          </View>
          {!!errors.password && <Text style={s.error}>{errors.password}</Text>}

          {/* Forgot password */}
          <TouchableOpacity
            onPress={handleForgotPassword}
            style={s.forgotWrap}
            disabled={resetting}
            activeOpacity={0.7}
          >
            {resetting
              ? <ActivityIndicator size="small" color={theme.primary} />
              : <Text style={s.forgotText}>Forgot Password?</Text>}
          </TouchableOpacity>

          {/* Login failure (wrong password, network, …) */}
          {!!errors.form && (
            <View style={s.formError}>
              <Ionicons name="alert-circle" size={18} color="#E5484D" />
              <Text style={s.formErrorText}>{errors.form}</Text>
            </View>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>

        {/* Footer actions — same layout as signup */}
        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={s.footerRow}>
            <TouchableOpacity style={s.backBtn} onPress={goToTabs} activeOpacity={0.8}>
              <Ionicons name="arrow-back" size={20} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, loading && { opacity: 0.65 }]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnText}>Login</Text>}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.signupWrap} onPress={() => router.push("/(auth)/signup")} activeOpacity={0.7}>
            <Text style={s.signupText}>Don't have an account? </Text>
            <Text style={[s.signupText, { color: theme.primary, fontWeight: "700" }]}>Sign Up</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const makeStyles = (theme: LoginTheme) =>
  StyleSheet.create({
    kav:     { flex: 1, backgroundColor: theme.background },
    scroll:  { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: 24, paddingTop: 20 },

    title:    { fontSize: 28, fontWeight: "800", color: theme.text, marginBottom: 6 },
    subtitle: { fontSize: 14, color: theme.subText, marginBottom: 6, fontWeight: "500" },

    label: {
      fontSize: 13, fontWeight: "700", color: theme.text,
      marginBottom: 6, marginTop: 16,
      textTransform: "uppercase", letterSpacing: 0.4,
    },
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

    // Password
    pwWrap: {
      flexDirection: "row", alignItems: "center",
      backgroundColor: theme.card, borderRadius: 12,
      borderWidth: 1, borderColor: theme.border, paddingRight: 8,
    },
    pwInput: { flex: 1, padding: 14, fontSize: 15, color: theme.text },
    eyeBtn:  { padding: 8 },

    forgotWrap: { alignSelf: "flex-end", marginTop: 12, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
    forgotText: { color: theme.primary, fontSize: 14, fontWeight: "700" },

    formError: {
      flexDirection: "row", alignItems: "flex-start", gap: 8,
      marginTop: 16, padding: 12, borderRadius: 12,
      backgroundColor: "rgba(229,72,77,0.10)",
      borderWidth: 1, borderColor: "rgba(229,72,77,0.35)",
    },
    formErrorText: { flex: 1, fontSize: 13, fontWeight: "600", color: "#E5484D", lineHeight: 18 },

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

    signupWrap: { flexDirection: "row", justifyContent: "center", marginTop: 18 },
    signupText: { fontSize: 14, color: theme.subText },
  });
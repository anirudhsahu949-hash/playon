/**
 * app/apl/register.tsx — APL player registration form + payment.
 *
 * Flow: fill the form → photo goes to Cloudinary → Pay sheet → Razorpay →
 * server verifies → app/apl/status.
 *
 * Reads everything about the league from Firestore: appConfig/{leagueId}.
 * Nothing about fees or dates is hardcoded here, so you change them in the
 * admin/Firebase without a new app build.
 *
 * Needs on the server (already added): /create-apl-order, /verify-apl-payment
 */
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Image,
  ActivityIndicator, Alert, Modal, StatusBar, Platform, Linking,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc } from "firebase/firestore";
// Razorpay is a native module: present in a real build (expo run:android / EAS),
// simply absent in Expo Go. Loading it this way keeps the screen from crashing
// there, and still uses the real checkout wherever the module exists.
let RazorpayCheckout: any = null;
try {
  const mod = require("react-native-razorpay");
  RazorpayCheckout = mod?.default ?? mod ?? null;
} catch {
  RazorpayCheckout = null;
}

import { auth, db } from "../../firebaseConfig";
import { pickPhotos, takePhoto, uploadPhoto, cldThumb } from "../../utils/cloudinary";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

const GREEN   = "#16A34A";
const GREEN_D = "#15803D";
const DARK    = "#0B1220";
const BG      = "#F3F4F6";
const BORDER  = "#E5E7EB";
const MUTED   = "#6B7280";

const ROLES   = ["Batsman", "Bowler", "All-rounder", "Wicketkeeper"];
const BATTING = ["Right hand", "Left hand"];
const BOWLING = ["Fast", "Medium pace", "Spin", "I do not bowl"];
const SIZES   = ["S", "M", "L", "XL", "XXL"];

type Cfg = {
  leagueName: string; season: string; fee: number; gatewayCharge: number;
  registrationOpen: boolean; lastDate: string; leagueDates: string; venue: string;
};

export default function AplRegister() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ leagueId?: string }>();
  const leagueId = (params.leagueId as string) || "apl-2026";

  const [cfg, setCfg]         = useState<Cfg | null>(null);
  const [loading, setLoading] = useState(true);
  const [closed, setClosed]   = useState<string | null>(null);

  // form
  const [name, setName]           = useState("");
  const [mobile, setMobile]       = useState("");
  const [age, setAge]             = useState("");
  const [area, setArea]           = useState("");
  const [role, setRole]           = useState("");
  const [batting, setBatting]     = useState("");
  const [bowling, setBowling]     = useState("");
  const [size, setSize]           = useState("");
  const [jName, setJName]         = useState("");
  const [jNo, setJNo]             = useState("");
  const [experience, setExperience] = useState("");
  const [instagram, setInstagram]   = useState("");
  const [emergency, setEmergency]   = useState("");

  // photo
  const [photoLocal, setPhotoLocal] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl]     = useState<string | null>(null);
  const [photoBusy, setPhotoBusy]   = useState(false);

  // pay
  const [sheet, setSheet]   = useState(false);
  const [agree, setAgree]   = useState(true);
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);

  // ── load config + prefill ───────────────────────────────────────────────
  useEffect(() => {
    // wake the server up — Render's free tier sleeps and the first call is slow
    fetch(`${SERVER_URL}/`).catch(() => {});

    (async () => {
      try {
        if (!auth.currentUser) {
          setLoading(false);
          Alert.alert("Login required", "Please log in to register for the league.", [
            { text: "Cancel", style: "cancel", onPress: () => router.back() },
            { text: "Log in", onPress: () => router.push("/(auth)/login") },
          ]);
          return;
        }

        const snap = await getDoc(doc(db, "appConfig", leagueId));
        if (!snap.exists()) {
          setClosed("This league is not open yet.");
          setLoading(false);
          return;
        }
        const c = snap.data() as any;
        const conf: Cfg = {
          leagueName:       c.leagueName || "League",
          season:           c.season || "",
          fee:              Number(c.fee || 0),
          gatewayCharge:    Number(c.gatewayCharge || 0),
          registrationOpen: c.registrationOpen !== false,
          lastDate:         c.lastDate || "",
          leagueDates:      c.leagueDates || "",
          venue:            c.venue || "",
        };
        setCfg(conf);
        if (!conf.registrationOpen) setClosed("Registration for this league is closed.");

        // already registered? → straight to the status screen
        const regSnap = await getDoc(doc(db, "aplRegistrations", `${leagueId}_${auth.currentUser.uid}`));
        if (regSnap.exists() && regSnap.data()?.paymentStatus === "paid") {
          router.replace({ pathname: "/apl/status", params: { leagueId } } as any);
          return;
        }

        // prefill from the PlayOn account
        const uSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (uSnap.exists()) {
          const u = uSnap.data() as any;
          setName(u.name || auth.currentUser.displayName || "");
          const m = String(u.phone || u.mobile || "").replace(/\D/g, "").slice(-10);
          if (m.length === 10) setMobile(m);
        } else {
          setName(auth.currentUser.displayName || "");
        }
      } catch (e: any) {
        setClosed("Could not load the league details. Check your internet and try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [leagueId]);

  // ── photo ───────────────────────────────────────────────────────────────
  const choosePhoto = () => {
    Alert.alert("Your photo", "This photo is shown to team owners in the auction.", [
      { text: "Take a photo", onPress: () => grabPhoto("camera") },
      { text: "Choose from gallery", onPress: () => grabPhoto("gallery") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const grabPhoto = async (from: "camera" | "gallery") => {
    try {
      const uri = from === "camera" ? await takePhoto() : (await pickPhotos(1))[0];
      if (!uri) return;
      setPhotoLocal(uri);
      setPhotoUrl(null);
      setPhotoBusy(true);
      const url = await uploadPhoto(uri, "apl-player");
      setPhotoUrl(url);
    } catch (e: any) {
      if (e?.message === "PERMISSION") {
        Alert.alert("Permission needed", "Allow photo access in settings to add your photo.");
      } else {
        Alert.alert("Upload failed", "Your photo could not be uploaded. Please try again.");
        setPhotoLocal(null);
      }
    } finally {
      setPhotoBusy(false);
    }
  };

  // ── validate ────────────────────────────────────────────────────────────
  const openSheet = () => {
    if (!photoUrl)                     return Alert.alert("Photo needed", photoBusy ? "Your photo is still uploading — one moment." : "Add your photo first. Team owners see it in the auction.");
    if (name.trim().length < 2)        return Alert.alert("Name", "Enter your full name.");
    if (mobile.replace(/\D/g, "").length !== 10) return Alert.alert("Mobile", "Enter a valid 10-digit mobile number.");
    const a = Number(age);
    if (!a || a < 10 || a > 70)        return Alert.alert("Age", "Enter your correct age.");
    if (!area.trim())                  return Alert.alert("Area", "Which area of the city do you play in?");
    if (!role)                         return Alert.alert("Role", "Choose your playing role.");
    if (!batting)                      return Alert.alert("Batting", "Choose your batting hand.");
    if (!bowling)                      return Alert.alert("Bowling", "Choose your bowling style.");
    if (!size)                         return Alert.alert("Jersey", "Choose your jersey size.");
    setSheet(true);
  };

  // ── pay ─────────────────────────────────────────────────────────────────
  const payNow = async () => {
    if (payingRef.current || !cfg || !auth.currentUser) return;
    if (!agree) return Alert.alert("One more step", "Please accept the rules and refund policy.");

    payingRef.current = true;
    setPaying(true);
    try {
      const token = await auth.currentUser.getIdToken();

      const orderRes = await fetch(`${SERVER_URL}/create-apl-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          leagueId,
          name: name.trim(),
          mobile: mobile.replace(/\D/g, "").slice(-10),
          age: Number(age),
          area: area.trim(),
          role, battingHand: batting, bowlingStyle: bowling,
          jerseySize: size,
          jerseyName: jName.trim().toUpperCase(),
          jerseyNo: jNo.trim(),
          photoUrl,
          experience: experience.trim(),
          instagram: instagram.trim(),
          emergencyContact: emergency.replace(/\D/g, "").slice(-10),
        }),
      });
      const order = await orderRes.json();

      if (!orderRes.ok || !order.orderId) {
        if (order?.alreadyRegistered) {
          setSheet(false);
          router.replace({ pathname: "/apl/status", params: { leagueId } } as any);
          return;
        }
        throw new Error(order?.error || "Could not start the payment.");
      }

      const payment: any = await RazorpayCheckout.open({
        key:         order.key,
        order_id:    order.orderId,
        amount:      order.amount,
        currency:    order.currency || "INR",
        name:        cfg.leagueName,
        description: "Player registration",
        prefill: {
          name:    name.trim(),
          contact: mobile.replace(/\D/g, "").slice(-10),
          email:   auth.currentUser.email || "",
        },
        theme: { color: GREEN },
      });

      const verifyRes = await fetch(`${SERVER_URL}/verify-apl-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id:   payment.razorpay_order_id,
          payment_id: payment.razorpay_payment_id,
          signature:  payment.razorpay_signature,
        }),
      });
      const verify = await verifyRes.json();

      if (!verify.success) {
        if (verify.autoRefunded) {
          Alert.alert("Already registered", verify.error || "Your payment has been refunded.");
          setSheet(false);
          return;
        }
        throw new Error(verify.error || "Payment could not be confirmed. If money was deducted, contact support with your payment ID.");
      }

      setSheet(false);
      router.replace({ pathname: "/apl/status", params: { leagueId, fresh: "1" } } as any);
    } catch (e: any) {
      const raw  = e?.description || e?.error?.description || e?.message || "";
      const code = e?.code;
      if (code === "PAYMENT_CANCELLED" || /cancel/i.test(raw)) {
        Alert.alert("Payment cancelled", "Nothing was charged. You can try again.");
      } else if (/network|internet/i.test(raw)) {
        Alert.alert("Network problem", "Check your internet and try again.");
      } else {
        Alert.alert("Could not complete", raw || "Something went wrong. Please try again.");
      }
    } finally {
      payingRef.current = false;
      setPaying(false);
    }
  };

  // ── screens ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: BG }]}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  if (closed || !cfg) {
    return (
      <SafeAreaView style={[s.center, { backgroundColor: BG, padding: 28 }]}>
        <Ionicons name="lock-closed-outline" size={40} color={MUTED} />
        <Text style={s.closedTxt}>{closed || "League not available."}</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.closedBtn}>
          <Text style={s.closedBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const total = cfg.fee + cfg.gatewayCharge;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#374151" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>Player Registration</Text>
          <Text style={s.hSub} numberOfLines={1}>{cfg.leagueName}{cfg.season ? ` · ${cfg.season}` : ""}</Text>
        </View>
        <View style={s.stepPill}><Text style={s.stepTxt}>STEP 1 / 2</Text></View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        {/* photo */}
        <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 14 }]}>
          <TouchableOpacity onPress={choosePhoto} activeOpacity={0.85} style={s.photoBtn}>
            {photoLocal ? (
              <>
                <Image source={{ uri: photoUrl ? cldThumb(photoUrl, 300) : photoLocal }} style={s.photoImg} />
                {photoBusy && (
                  <View style={s.photoOverlay}><ActivityIndicator color="#FFFFFF" /></View>
                )}
              </>
            ) : (
              <>
                <Ionicons name="camera-outline" size={22} color={GREEN_D} />
                <Text style={s.photoAdd}>ADD</Text>
              </>
            )}
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Your photo <Text style={s.req}>*</Text></Text>
            <Text style={s.hint}>
              {photoBusy ? "Uploading…" : photoUrl ? "Photo added. Tap to change." : "Team owners see this face during the auction. A clear front photo works best."}
            </Text>
          </View>
        </View>

        <Text style={s.section}>YOUR DETAILS</Text>
        <View style={s.card}>
          <Field label="Full name" required value={name} onChange={setName} placeholder="e.g. Rahul Deshmukh" autoCapitalize="words" />
          <Field label="Mobile number (WhatsApp)" required value={mobile} onChange={(v) => setMobile(v.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit number" keyboardType="phone-pad" />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label="Age" required value={age} onChange={(v) => setAge(v.replace(/\D/g, "").slice(0, 2))} placeholder="22" keyboardType="number-pad" />
            </View>
            <View style={{ flex: 2 }}>
              <Field label="Area in the city" required value={area} onChange={setArea} placeholder="e.g. Rajapeth" />
            </View>
          </View>
        </View>

        <Text style={s.section}>HOW YOU PLAY</Text>
        <View style={s.card}>
          <Chips label="Your role" required options={ROLES} value={role} onPick={setRole} />
          <Chips label="Batting hand" required options={BATTING} value={batting} onPick={setBatting} />
          <Chips label="Bowling" required options={BOWLING} value={bowling} onPick={setBowling} />
        </View>

        <Text style={s.section}>JERSEY</Text>
        <View style={s.card}>
          <Chips label="Size" required options={SIZES} value={size} onPick={setSize} />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 2 }}>
              <Field label="Name on jersey" value={jName} onChange={(v) => setJName(v.toUpperCase().slice(0, 14))} placeholder="RAHUL" autoCapitalize="characters" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Number" value={jNo} onChange={(v) => setJNo(v.replace(/\D/g, "").slice(0, 3))} placeholder="18" keyboardType="number-pad" />
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 14, marginBottom: 8 }}>
          <Text style={[s.section, { marginTop: 0, marginBottom: 0 }]}>OPTIONAL</Text>
          <Text style={s.hint}>— helps you in the auction</Text>
        </View>
        <View style={s.card}>
          <Field label="Teams you have played for" value={experience} onChange={setExperience} placeholder="e.g. Shivaji XI, college team" />
          <Field label="Instagram ID" value={instagram} onChange={setInstagram} placeholder="@yourhandle" autoCapitalize="none" />
          <Field label="Emergency contact number" value={emergency} onChange={(v) => setEmergency(v.replace(/\D/g, "").slice(0, 10))} placeholder="Family member's number" keyboardType="phone-pad" />
        </View>
      </ScrollView>

      {/* sticky bar */}
      <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View>
          <Text style={s.total}>₹{total}</Text>
          <Text style={s.hint}>total payable</Text>
        </View>
        <TouchableOpacity style={s.cta} activeOpacity={0.9} onPress={openSheet}>
          <Text style={s.ctaTxt}>Continue to Payment</Text>
          <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* pay sheet */}
      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => !paying && setSheet(false)}>
        <View style={s.backdrop}>
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={s.handle} />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={s.sheetTitle}>Confirm &amp; pay</Text>
              <TouchableOpacity onPress={() => !paying && setSheet(false)} hitSlop={10} style={s.closeBtn}>
                <Ionicons name="close" size={18} color="#374151" />
              </TouchableOpacity>
            </View>

            <View style={s.payerRow}>
              {photoUrl ? <Image source={{ uri: cldThumb(photoUrl, 120) }} style={s.payerImg} /> : <View style={s.payerImg} />}
              <View style={{ flex: 1 }}>
                <Text style={s.payerName}>{name.trim()}</Text>
                <Text style={s.hint}>{role} · {batting} · {bowling}</Text>
              </View>
            </View>

            <Row label={`${cfg.leagueName} registration fee`} value={`₹${cfg.fee}`} />
            {cfg.gatewayCharge > 0 && <Row label="Payment gateway charge" value={`₹${cfg.gatewayCharge}`} />}
            <View style={s.divider} />
            <Row label="Total payable" value={`₹${total}`} big />

            <View style={s.refundBox}>
              <Ionicons name="refresh" size={17} color={GREEN_D} style={{ marginTop: 1 }} />
              <Text style={s.refundTxt}>
                If no team picks you in the auction, the full ₹{cfg.fee} is refunded within 7 working days.
                {cfg.gatewayCharge > 0 ? ` The ₹${cfg.gatewayCharge} gateway charge is not refundable.` : ""}
              </Text>
            </View>

            <TouchableOpacity style={s.agreeRow} activeOpacity={0.8} onPress={() => setAgree(!agree)}>
              <Ionicons name={agree ? "checkbox" : "square-outline"} size={21} color={agree ? GREEN : "#9CA3AF"} />
              <Text style={s.agreeTxt}>I have read the league rules and agree to the registration terms and refund policy.</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.payBtn, paying && { opacity: 0.7 }]}
              activeOpacity={0.9}
              disabled={paying}
              onPress={payNow}
            >
              {paying
                ? <ActivityIndicator color="#FFFFFF" />
                : <><Ionicons name="lock-closed" size={17} color="#FFFFFF" /><Text style={s.payTxt}>Pay ₹{total}</Text></>}
            </TouchableOpacity>
            <Text style={[s.hint, { textAlign: "center", marginTop: 8 }]}>Secured by Razorpay · UPI, card, netbanking</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ── small pieces ───────────────────────────────────────────────────────── */

function Field({ label, value, onChange, placeholder, required, keyboardType, autoCapitalize }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label} {required && <Text style={s.req}>*</Text>}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType || "default"}
        autoCapitalize={autoCapitalize || "sentences"}
      />
    </View>
  );
}

function Chips({ label, options, value, onPick, required }: any) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.label}>{label} {required && <Text style={s.req}>*</Text>}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 9 }}>
        {options.map((o: string) => {
          const on = value === o;
          return (
            <TouchableOpacity key={o} onPress={() => onPick(o)} activeOpacity={0.85}
              style={[s.chip, on && { backgroundColor: GREEN, borderColor: GREEN }]}>
              <Text style={[s.chipTxt, on && { color: "#FFFFFF", fontWeight: "700" }]}>{o}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function Row({ label, value, big }: any) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 11 }}>
      <Text style={[s.rowLabel, big && { fontSize: 14.5, fontWeight: "700", color: "#111827" }]}>{label}</Text>
      <Text style={[s.rowValue, big && { fontSize: 20, fontWeight: "800" }]}>{value}</Text>
    </View>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  closedTxt: { marginTop: 14, fontSize: 15, color: "#374151", textAlign: "center", lineHeight: 22 },
  closedBtn: { marginTop: 18, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, backgroundColor: DARK },
  closedBtnTxt: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

  header: {
    backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: BORDER,
    paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12,
  },
  backBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  hSub: { fontSize: 12, color: MUTED, marginTop: 1 },
  stepPill: { backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  stepTxt: { fontSize: 11, fontWeight: "700", color: GREEN_D },

  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 16 },
  cardTitle: { fontSize: 13.5, fontWeight: "700", color: "#111827" },
  section: { fontSize: 12, fontWeight: "800", color: MUTED, letterSpacing: 0.7, marginTop: 16, marginBottom: 8 },
  hint: { fontSize: 11.5, color: MUTED, lineHeight: 17, marginTop: 3 },
  req: { color: "#DC2626" },

  photoBtn: {
    width: 86, height: 86, borderRadius: 999, borderWidth: 2, borderStyle: "dashed",
    borderColor: GREEN, backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  photoImg: { width: 86, height: 86, borderRadius: 999 },
  photoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  photoAdd: { fontSize: 10, fontWeight: "700", color: GREEN_D, marginTop: 3 },

  label: { fontSize: 12.5, fontWeight: "600", color: "#374151" },
  input: {
    height: 46, marginTop: 7, paddingHorizontal: 13, borderWidth: 1.5, borderColor: BORDER,
    borderRadius: 10, fontSize: 14, color: "#111827", backgroundColor: "#FFFFFF",
  },
  chip: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER, backgroundColor: "#FFFFFF" },
  chipTxt: { fontSize: 13, fontWeight: "600", color: "#374151" },

  bottomBar: {
    backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: BORDER,
    paddingHorizontal: 16, paddingTop: 12, flexDirection: "row", alignItems: "center", gap: 14,
  },
  total: { fontSize: 19, fontWeight: "800", color: "#111827" },
  cta: { flex: 1, height: 52, borderRadius: 12, backgroundColor: GREEN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  ctaTxt: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },

  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 10 },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 999, backgroundColor: "#D1D5DB", marginBottom: 14 },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: "#111827" },
  closeBtn: { width: 32, height: 32, borderRadius: 999, backgroundColor: BG, alignItems: "center", justifyContent: "center" },

  payerRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 11, marginTop: 14 },
  payerImg: { width: 42, height: 42, borderRadius: 999, backgroundColor: "#E5E7EB" },
  payerName: { fontSize: 13.5, fontWeight: "700", color: "#111827" },

  rowLabel: { fontSize: 13.5, color: "#374151" },
  rowValue: { fontSize: 13.5, fontWeight: "600", color: "#111827" },
  divider: { height: 1, backgroundColor: BORDER, marginTop: 11 },

  refundBox: { flexDirection: "row", gap: 10, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 12, padding: 12, marginTop: 16 },
  refundTxt: { flex: 1, fontSize: 12.5, color: "#14532D", lineHeight: 19 },

  agreeRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 16 },
  agreeTxt: { flex: 1, fontSize: 12.5, color: "#374151", lineHeight: 19 },

  payBtn: { height: 54, borderRadius: 12, backgroundColor: GREEN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: 16 },
  payTxt: { color: "#FFFFFF", fontSize: 15.5, fontWeight: "700" },
});

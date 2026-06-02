import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  Linking,
  ActivityIndicator,
  LayoutAnimation,
  UIManager,
} from "react-native";
import { useEffect, useRef, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BRAND = "#0B1220";

// ─── Contact channels ─────────────────────────────────────────────────────────
const CONTACTS = [
  {
    icon:   "logo-whatsapp" as const,
    label:  "WhatsApp",
    sub:    "Fastest · Usually < 1 hr",
    color:  "#25D366",
    bg:     "#F0FDF4",
    border: "#BBF7D0",
    action: () => Linking.openURL("https://wa.me/918055955805?text=Hi%20Playon%2C%20I%20need%20help%20as%20a%20player"),
  },
  {
    icon:   "mail-outline" as const,
    label:  "Email Us",
    sub:    "support@playon.app · 24 hr",
    color:  "#2563EB",
    bg:     "#EFF6FF",
    border: "#BFDBFE",
    action: () => Linking.openURL("mailto:playonsport03@gmail.com.app?subject=Player%20Support%20Request"),
  },
  {
    icon:   "call-outline" as const,
    label:  "Call Us",
    sub:    "Mon–Sat, 9 AM – 7 PM",
    color:  "#7C3AED",
    bg:     "#F5F3FF",
    border: "#DDD6FE",
     action: () =>
      Alert.alert(
        "Coming Soon",
        "Phone support will be available soon on Playon."
      ),
  },
  {
    icon:   "logo-instagram" as const,
    label:  "Instagram",
    sub:    "@playonapp · DM anytime",
    color:  "#E1306C",
    bg:     "#FDF2F8",
    border: "#FBCFE8",
     action: () =>
      Alert.alert(
        "Coming Soon",
        "Instagram support will be available soon on Playon."
      ),
  
  },
];

// ─── FAQ data ─────────────────────────────────────────────────────────────────
const FAQS = [
  {
    q: "How do I book a turf?",
    a: "Open any turf from the Explore tab. Pick your date, select time slots, then choose Full Payment or Advance Payment and complete checkout via Razorpay. You'll receive a booking confirmation immediately.",
  },
  {
    q: "What is advance payment?",
    a: "Advance payment lets you lock your slot by paying only a small booking amount upfront. You pay the remaining balance directly at the turf when you arrive. The advance amount is set by the turf owner.",
  },
  {
    q: "Can I cancel my booking?",
    a: "Yes — go to My Bookings, find the booking, and tap Cancel. Cancellation is only available for upcoming bookings that haven't passed yet. Refund eligibility depends on the turf's cancellation policy.",
  },
  {
    q: "How long does a refund take?",
    a: "Refunds are processed back to your original payment method within 5–7 business days after cancellation is confirmed. If you don't see it after 7 days, contact us with your booking ID.",
  },
  {
    q: "A booked slot still shows as available — is that normal?",
    a: "This is a display refresh issue. Pull down on the Explore screen to reload slot availability. If the problem continues after refreshing, contact us right away with the turf name and date.",
  },
  {
    q: "I was charged but didn't get a confirmation — what do I do?",
    a: "Don't worry. Sometimes confirmations are delayed by a few minutes. Check My Bookings first. If the booking isn't there after 10 minutes, contact us immediately with your payment screenshot.",
  },
  {
    q: "How do I change my booking date or time?",
    a: "Playon currently doesn't support rescheduling. You'll need to cancel the existing booking and create a new one for your preferred time. Refund policies apply to the cancelled booking.",
  },
  {
    q: "How do I update my profile details?",
    a: "Go to Profile → Edit Profile. You can update your name, phone number, location, and favourite sport from there.",
  },
  {
  q: "How can I add my turf on Playon?",
  a: "Own a turf or sports venue? We'd love to partner with you. Contact our team on WhatsApp with your venue name, location, sports offered, pricing, and a few photos. We'll guide you through the onboarding process and help you start accepting bookings on Playon.",
},
];

// ─── Ticket categories ────────────────────────────────────────────────────────
const CATEGORIES = [
  "Booking Issue",
  "Payment / Refund",
  "Slot Problem",
  "App Bug",
  "Account",
  "Other",
];

// ─── FAQ accordion item ───────────────────────────────────────────────────────
function FaqItem({ q, a, isLast }: { q: string; a: string; isLast: boolean }) {
  const [open, setOpen] = useState(false);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(o => !o);
  };

  return (
    <TouchableOpacity
      style={[s.faqItem, isLast && s.faqItemLast]}
      onPress={toggle}
      activeOpacity={0.75}
    >
      <View style={s.faqRow}>
        <View style={[s.faqDot, open && s.faqDotOpen]} />
        <Text style={[s.faqQ, open && s.faqQOpen]}>{q}</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={15}
          color={open ? BRAND : "#9CA3AF"}
        />
      </View>
      {open && (
        <Text style={s.faqA}>{a}</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function UserSupport() {
  const router = useRouter();

  const [userName,  setUserName]  = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPhone, setUserPhone] = useState("");

  const [category, setCategory] = useState("");
  const [subject,  setSubject]  = useState("");
  const [message,  setMessage]  = useState("");
  const [sending,  setSending]  = useState(false);
  const [sent,     setSent]     = useState(false);

  const msgRef = useRef<TextInput>(null);

  useEffect(() => {
    const load = async () => {
      const u = auth.currentUser;
      if (!u) return;
      setUserEmail(u.email ?? "");
      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        if (snap.exists()) {
          const d = snap.data();
          setUserName(d.name  || "");
          setUserPhone(d.phone || "");
        }
      } catch (e) { console.error(e); }
    };
    load();
  }, []);

  const handleSubmit = async () => {
    if (!category) {
      Alert.alert("Select a category", "Please choose what your issue is about.");
      return;
    }
    if (message.trim().length < 20) {
      Alert.alert("More detail needed", "Please describe your issue in at least 20 characters.");
      return;
    }

    try {
      setSending(true);
      await addDoc(collection(db, "supportTickets"), {
        uid:       auth.currentUser?.uid || null,
        userName:  userName  || "Guest",
        userEmail: userEmail || "",
        userPhone: userPhone || "",
        source:    "user",
        category,
        subject:   subject.trim() || category,
        message:   message.trim(),
        status:    "open",
        createdAt: serverTimestamp(),
      });
      setSent(true);
      setCategory("");
      setSubject("");
      setMessage("");
    } catch (e) {
      Alert.alert("Error", "Could not send. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>

          <Text style={s.headerEyebrow}>Player Support</Text>
          <Text style={s.headerTitle}>How can we{"\n"}help you?</Text>
          <Text style={s.headerSub}>
            We typically respond within 1 hour on WhatsApp and 24 hours by email.
          </Text>

          {/* Response time badges */}
          <View style={s.badgeRow}>
            <View style={s.badge}>
              <Ionicons name="flash-outline" size={12} color="#FCD34D" />
              <Text style={s.badgeTxt}>WhatsApp in &lt;1 hr</Text>
            </View>
            <View style={s.badge}>
              <Ionicons name="mail-outline" size={12} color="#93C5FD" />
              <Text style={s.badgeTxt}>Email in 24 hrs</Text>
            </View>
          </View>
        </View>

        {/* ── Quick contact ────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Reach Us Directly</Text>
          <View style={s.contactGrid}>
            {CONTACTS.map(c => (
              <TouchableOpacity
                key={c.label}
                style={[s.contactCard, { backgroundColor: c.bg, borderColor: c.border }]}
                onPress={c.action}
                activeOpacity={0.8}
              >
                <View style={[s.contactIcon, { backgroundColor: c.color }]}>
                  <Ionicons name={c.icon} size={19} color="#fff" />
                </View>
                <Text style={[s.contactLabel, { color: c.color }]}>{c.label}</Text>
                <Text style={s.contactSub}>{c.sub}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Ticket form ──────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Send a Support Request</Text>
          <Text style={s.sectionSub}>
            We'll reply to <Text style={{ fontWeight: "700", color: BRAND }}>{userEmail || "your email"}</Text>
          </Text>

          {sent ? (
            <View style={s.successCard}>
              <View style={s.successIconWrap}>
                <Ionicons name="checkmark-circle" size={48} color="#059669" />
              </View>
              <Text style={s.successTitle}>Message sent!</Text>
              <Text style={s.successSub}>
                We've got your request and will reply to{"\n"}
                <Text style={{ fontWeight: "700", color: BRAND }}>{userEmail || "your email"}</Text>
                {"\n"}within 24 hours.
              </Text>
              <TouchableOpacity style={s.successBtn} onPress={() => setSent(false)} activeOpacity={0.8}>
                <Text style={s.successBtnTxt}>Send another message</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.formCard}>
              {/* Sender info pill */}
              {!!userName && (
                <View style={s.senderPill}>
                  <View style={s.senderAvatar}>
                    <Text style={s.senderAvatarTxt}>
                      {userName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View>
                    <Text style={s.senderName}>{userName}</Text>
                    <Text style={s.senderEmail}>{userEmail}</Text>
                  </View>
                </View>
              )}

              {/* Category */}
              <Text style={s.fieldLabel}>What's this about? <Text style={s.req}>*</Text></Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.catRow}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[s.catChip, category === c && s.catChipOn]}
                    onPress={() => setCategory(c)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.catTxt, category === c && s.catTxtOn]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Subject */}
              <Text style={s.fieldLabel}>Subject</Text>
              <TextInput
                value={subject}
                onChangeText={setSubject}
                placeholder="e.g. Payment deducted but no booking"
                placeholderTextColor="#C4C9D4"
                style={s.input}
                returnKeyType="next"
                onSubmitEditing={() => msgRef.current?.focus()}
              />

              {/* Message */}
              <Text style={s.fieldLabel}>Describe your issue <Text style={s.req}>*</Text></Text>
              <TextInput
                ref={msgRef}
                value={message}
                onChangeText={setMessage}
                placeholder="Include your booking ID, turf name, date and what went wrong. The more detail, the faster we can help."
                placeholderTextColor="#C4C9D4"
                style={s.textArea}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
              <Text style={[s.charHint, message.length >= 20 && s.charHintOk]}>
                {message.length < 20 ? `${20 - message.length} more characters needed` : "✓ Good to go"}
              </Text>

              <TouchableOpacity
                style={[s.submitBtn, (sending || message.length < 20 || !category) && s.submitBtnDim]}
                onPress={handleSubmit}
                disabled={sending}
                activeOpacity={0.85}
              >
                {sending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <>
                      <Ionicons name="send-outline" size={16} color="#fff" />
                      <Text style={s.submitTxt}>Send Message</Text>
                    </>
                }
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── FAQ ─────────────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Common Questions</Text>
          <Text style={s.sectionSub}>Tap a question to read the answer</Text>
          <View style={s.faqCard}>
            {FAQS.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} isLast={i === FAQS.length - 1} />
            ))}
          </View>
        </View>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <View style={s.footer}>
          <View style={s.footerRow}>
            <Ionicons name="time-outline" size={13} color="#9CA3AF" />
            <Text style={s.footerTxt}>Support hours: Mon – Sat, 9 AM – 7 PM IST</Text>
          </View>
          <View style={s.footerRow}>
            <Ionicons name="shield-checkmark-outline" size={13} color="#9CA3AF" />
            <Text style={s.footerTxt}>All conversations are private and secure</Text>
          </View>
          <Text style={s.version}>Playon v1.0.1</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#F5F6FA" },
  scroll: { paddingBottom: 48 },

  header: {
    backgroundColor: BRAND,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 16,
    paddingBottom: 32,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 20,
  },
  headerEyebrow: { fontSize: 11, fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  headerTitle:   { fontSize: 30, fontWeight: "800", color: "#fff", letterSpacing: -0.5, lineHeight: 36 },
  headerSub:     { fontSize: 14, color: "#64748B", marginTop: 10, lineHeight: 21 },
  badgeRow:      { flexDirection: "row", gap: 8, marginTop: 16 },
  badge:         { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99 },
  badgeTxt:      { fontSize: 12, fontWeight: "600", color: "#CBD5E1" },

  section:      { paddingHorizontal: 16, marginTop: 24 },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: BRAND, marginBottom: 4 },
  sectionSub:   { fontSize: 13, color: "#9CA3AF", marginBottom: 14, lineHeight: 19 },

  contactGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  contactCard: { width: "47.5%", borderRadius: 14, borderWidth: 1, padding: 14 },
  contactIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  contactLabel:{ fontSize: 14, fontWeight: "800", marginBottom: 3 },
  contactSub:  { fontSize: 11, color: "#6B7280", lineHeight: 16 },

  formCard: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 16 },

  senderPill:      { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F5F6FA", borderRadius: 10, padding: 12, marginBottom: 16 },
  senderAvatar:    { width: 34, height: 34, borderRadius: 17, backgroundColor: BRAND, alignItems: "center", justifyContent: "center" },
  senderAvatarTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  senderName:      { fontSize: 13, fontWeight: "700", color: BRAND },
  senderEmail:     { fontSize: 12, color: "#9CA3AF" },

  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 8, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.5 },
  req:        { color: "#DC2626" },

  catRow:     { gap: 8, paddingBottom: 4 },
  catChip:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  catChipOn:  { backgroundColor: BRAND, borderColor: BRAND },
  catTxt:     { fontSize: 13, fontWeight: "600", color: "#374151" },
  catTxtOn:   { color: "#fff" },

  input:    { backgroundColor: "#F9FAFB", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: BRAND },
  textArea: { backgroundColor: "#F9FAFB", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 14, color: BRAND, minHeight: 130 },

  charHint:    { fontSize: 11, color: "#9CA3AF", marginTop: 5, textAlign: "right" },
  charHintOk:  { color: "#059669" },

  submitBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: BRAND, borderRadius: 12, paddingVertical: 14, marginTop: 16 },
  submitBtnDim: { opacity: 0.5 },
  submitTxt:    { fontSize: 15, fontWeight: "800", color: "#fff" },

  successCard:     { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 28, alignItems: "center" },
  successIconWrap: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#ECFDF5", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  successTitle:    { fontSize: 22, fontWeight: "800", color: BRAND, marginBottom: 8 },
  successSub:      { fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 22 },
  successBtn:      { marginTop: 20, backgroundColor: "#F3F4F6", paddingHorizontal: 24, paddingVertical: 11, borderRadius: 10 },
  successBtnTxt:   { fontSize: 14, fontWeight: "700", color: BRAND },

  faqCard:     { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  faqItem:     { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  faqItemLast: { borderBottomWidth: 0 },
  faqRow:      { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  faqDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: "#D1D5DB", marginTop: 7, flexShrink: 0 },
  faqDotOpen:  { backgroundColor: BRAND },
  faqQ:        { flex: 1, fontSize: 14, fontWeight: "600", color: "#374151", lineHeight: 20 },
  faqQOpen:    { color: BRAND, fontWeight: "700" },
  faqA:        { fontSize: 14, color: "#4B5563", lineHeight: 22, marginTop: 10, paddingLeft: 16 },

  footer:    { alignItems: "center", paddingHorizontal: 20, marginTop: 32, gap: 8 },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  footerTxt: { fontSize: 12, color: "#9CA3AF" },
  version:   { fontSize: 11, color: "#D1D5DB", marginTop: 8 },
});
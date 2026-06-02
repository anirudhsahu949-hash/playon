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

const BRAND  = "#0B1220";
const OWNER_ACCENT = "#0F766E"; // teal — distinct from user support blue

// ─── Priority contact channels for owners ────────────────────────────────────
const CONTACTS = [
  {
    icon:    "logo-whatsapp" as const,
    label:   "WhatsApp",
    sub:     "Dedicated owner line · Priority response",
    color:   "#25D366",
    bg:      "#F0FDF4",
    border:  "#BBF7D0",
    action:  () => Linking.openURL("https://wa.me/919999999998?text=Hi%20Playon%2C%20I%20am%20a%20turf%20owner%20and%20need%20support"),
  },
  {
    icon:    "mail-outline" as const,
    label:   "Owner Email",
    sub:     "owners@playon.app · 12 hr response",
    color:   OWNER_ACCENT,
    bg:      "#F0FDFA",
    border:  "#99F6E4",
    action:  () => Linking.openURL("mailto:owners@playon.app?subject=Turf%20Owner%20Support%20Request"),
  },
  {
    icon:    "call-outline" as const,
    label:   "Owner Helpline",
    sub:     "Mon–Sat, 9 AM – 8 PM IST",
    color:   "#7C3AED",
    bg:      "#F5F3FF",
    border:  "#DDD6FE",
    action:  () => Linking.openURL("tel:+919999999998"),
  },
  {
    icon:    "document-text-outline" as const,
    label:   "Partnership",
    sub:     "New listing or business queries",
    color:   "#B45309",
    bg:      "#FFFBEB",
    border:  "#FDE68A",
    action:  () => Linking.openURL("mailto:partner@playon.app?subject=Partnership%20Enquiry"),
  },
];

// ─── Owner-specific FAQ ───────────────────────────────────────────────────────
const FAQS = [
  {
    category: "Settlement",
    items: [
      {
        q: "How does the settlement process work?",
        a: "Advance payments collected by Playon are settled to your registered bank account every Monday. Full payment bookings are settled after deducting the platform commission (typically 10%). You'll receive a settlement summary via WhatsApp and email.",
      },
      {
        q: "I haven't received my settlement — what do I do?",
        a: "Settlements are processed every Monday. If you haven't received payment by Tuesday, contact us via WhatsApp with your turf name and the week in question. We'll investigate within 4 hours.",
      },
      {
        q: "What is the platform commission?",
        a: "Playon charges a commission on each booking for payment processing, platform hosting, and customer support. Your commission rate was agreed upon during onboarding. Contact us if you need clarification.",
      },
    ],
  },
  {
    category: "Turf Management",
    items: [
      {
        q: "How do I update my turf photos, pricing, or description?",
        a: "Send your updated details (new photos, pricing changes, or description) to owners@playon.app or WhatsApp us. Updates are reflected in the app within 24 working hours.",
      },
      {
        q: "How do I block time slots for maintenance or personal use?",
        a: "Open your Owner Dashboard → Block Slots. Select your turf, choose the date, and mark the specific slots you want blocked. Blocked slots won't appear as available to users.",
      },
      {
        q: "How do I add or manage a turf operator?",
        a: "Go to Owner Dashboard → Operators. You can create an operator account with their name, email, and phone. Operators can see today's bookings and manage slot check-ins but cannot modify turf details or view financials.",
      },
    ],
  },
  {
    category: "Bookings",
    items: [
      {
        q: "A user says they booked but I can't see it — what happened?",
        a: "First, pull to refresh on your bookings dashboard. If it still doesn't appear, ask the user for their Booking ID. WhatsApp us the ID and we'll verify the booking status within 1 hour.",
      },
      {
        q: "Can I cancel a user's booking on their behalf?",
        a: "Booking cancellations must be initiated by the user. If there's a special circumstance (e.g. your turf is unavailable), contact us and we'll process the cancellation and any applicable refund.",
      },
      {
        q: "How do I record a walk-in (offline) booking?",
        a: "Use the Block Slots screen and select Offline Booking. Enter the customer's name, phone and amount collected. This marks the slot as occupied and keeps your records clean.",
      },
    ],
  },
  {
    category: "Account",
    items: [
      {
        q: "How do I update my bank account for settlements?",
        a: "For security, bank account changes must be verified by our team. WhatsApp us your request with your turf name and new account details. We'll process it within 2 business days.",
      },
      {
        q: "How do I list a second turf on my account?",
        a: "Contact us via WhatsApp or email with the details of your new turf (name, location, sport, photos, pricing, opening hours). We'll add it to your existing owner account within 24 hours.",
      },
    ],
  },
];

// ─── FAQ accordion ────────────────────────────────────────────────────────────
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
          color={open ? OWNER_ACCENT : "#9CA3AF"}
        />
      </View>
      {open && <Text style={s.faqA}>{a}</Text>}
    </TouchableOpacity>
  );
}

// ─── Ticket categories ────────────────────────────────────────────────────────
const CATEGORIES = [
  "Settlement / Payment",
  "Booking Issue",
  "Turf Listing Update",
  "Operator Issue",
  "App Bug",
  "Partnership",
  "Other",
];

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function OwnerSupport() {
  const router = useRouter();

  const [ownerName,   setOwnerName]   = useState("");
  const [ownerEmail,  setOwnerEmail]  = useState("");
  const [ownerPhone,  setOwnerPhone]  = useState("");
  const [turfName,    setTurfName]    = useState("");

  const [category, setCategory] = useState("");
  const [subject,  setSubject]  = useState("");
  const [message,  setMessage]  = useState("");
  const [sending,  setSending]  = useState(false);
  const [sent,     setSent]     = useState(false);

  // FAQ category active filter
  const [faqCat, setFaqCat] = useState("All");
  const faqCategories = ["All", ...FAQS.map(f => f.category)];

  const msgRef = useRef<TextInput>(null);

  useEffect(() => {
    const load = async () => {
      const u = auth.currentUser;
      if (!u) return;
      setOwnerEmail(u.email ?? "");
      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        if (snap.exists()) {
          const d = snap.data();
          setOwnerName(d.name || "");
          setOwnerPhone(d.phone || "");
          // Try to load their first turf name for context
          if (d.role === "owner") {
            const { getDocs, query, where, collection: col } = await import("firebase/firestore");
            const turfSnap = await getDocs(
              query(col(db, "turfs"), where("ownerId", "==", u.uid))
            );
            if (!turfSnap.empty) {
              setTurfName(turfSnap.docs[0].data().name || "");
            }
          }
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
        uid:        auth.currentUser?.uid || null,
        ownerName:  ownerName  || "Owner",
        ownerEmail: ownerEmail || "",
        ownerPhone: ownerPhone || "",
        turfName:   turfName   || "",
        source:     "owner",           // distinct from "user" tickets
        category,
        subject:    subject.trim() || category,
        message:    message.trim(),
        status:     "open",
        priority:   category === "Settlement / Payment" ? "high" : "normal",
        createdAt:  serverTimestamp(),
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

  const visibleFaqs = faqCat === "All"
    ? FAQS
    : FAQS.filter(f => f.category === faqCat);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>

          {/* Owner badge */}
          <View style={s.ownerBadge}>
            <Ionicons name="business-outline" size={13} color={OWNER_ACCENT} />
            <Text style={s.ownerBadgeTxt}>Owner Support</Text>
          </View>

          <Text style={s.headerTitle}>How can we{"\n"}help your business?</Text>
          <Text style={s.headerSub}>
            Dedicated support for turf owners.{"\n"}Priority response on WhatsApp.
          </Text>

          {/* Turf context pill */}
          {!!turfName && (
            <View style={s.turfPill}>
              <Ionicons name="location-outline" size={13} color={OWNER_ACCENT} />
              <Text style={s.turfPillTxt}>{turfName}</Text>
            </View>
          )}

          {/* Response badges */}
          <View style={s.badgeRow}>
            <View style={s.badge}>
              <Ionicons name="flash-outline" size={12} color="#FCD34D" />
              <Text style={s.badgeTxt}>Priority WhatsApp</Text>
            </View>
            <View style={s.badge}>
              <Ionicons name="mail-outline" size={12} color="#6EE7B7" />
              <Text style={s.badgeTxt}>owners@playon.app</Text>
            </View>
          </View>
        </View>

        {/* ── Quick contact ────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Contact Owner Support</Text>
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
          <Text style={s.sectionTitle}>Submit a Support Ticket</Text>
          <Text style={s.sectionSub}>
            We'll reply to{" "}
            <Text style={{ fontWeight: "700", color: BRAND }}>{ownerEmail || "your email"}</Text>
            {" "}within 12 hours.{" "}
            <Text style={{ color: "#DC2626", fontWeight: "600" }}>Settlement issues are marked high priority.</Text>
          </Text>

          {sent ? (
            <View style={s.successCard}>
              <View style={s.successIconWrap}>
                <Ionicons name="checkmark-circle" size={48} color={OWNER_ACCENT} />
              </View>
              <Text style={s.successTitle}>Ticket submitted!</Text>
              <Text style={s.successSub}>
                Your request has been logged.{"\n"}We'll reply to{" "}
                <Text style={{ fontWeight: "700", color: BRAND }}>{ownerEmail}</Text>
                {"\n"}within 12 hours.
                {category === "Settlement / Payment" && (
                  "\n\nSettlement issues are handled as high priority."
                )}
              </Text>
              <TouchableOpacity style={s.successBtn} onPress={() => setSent(false)} activeOpacity={0.8}>
                <Text style={s.successBtnTxt}>Submit another ticket</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.formCard}>
              {/* Owner + turf context */}
              {(!!ownerName || !!turfName) && (
                <View style={s.senderPill}>
                  <View style={s.senderAvatar}>
                    <Ionicons name="business" size={16} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.senderName}>{ownerName || "Owner"}</Text>
                    <Text style={s.senderSub}>
                      {[turfName, ownerEmail].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                </View>
              )}

              {/* Category */}
              <Text style={s.fieldLabel}>Issue category <Text style={s.req}>*</Text></Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.catRow}>
                {CATEGORIES.map(c => {
                  const isHighPriority = c === "Settlement / Payment";
                  const isSelected = category === c;
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[
                        s.catChip,
                        isSelected && s.catChipOn,
                        isHighPriority && !isSelected && s.catChipUrgent,
                      ]}
                      onPress={() => setCategory(c)}
                      activeOpacity={0.7}
                    >
                      {isHighPriority && (
                        <Ionicons name="alert-circle" size={12} color={isSelected ? "#fff" : "#DC2626"} style={{ marginRight: 3 }} />
                      )}
                      <Text style={[
                        s.catTxt,
                        isSelected && s.catTxtOn,
                        isHighPriority && !isSelected && { color: "#DC2626" },
                      ]}>
                        {c}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* High priority notice */}
              {category === "Settlement / Payment" && (
                <View style={s.priorityNotice}>
                  <Ionicons name="alert-circle-outline" size={16} color="#DC2626" />
                  <Text style={s.priorityNoticeTxt}>
                    Settlement tickets are handled as high priority and reviewed within 4 hours on business days.
                  </Text>
                </View>
              )}

              {/* Subject */}
              <Text style={s.fieldLabel}>Subject</Text>
              <TextInput
                value={subject}
                onChangeText={setSubject}
                placeholder="e.g. Settlement for week of May 5 not received"
                placeholderTextColor="#C4C9D4"
                style={s.input}
                returnKeyType="next"
                onSubmitEditing={() => msgRef.current?.focus()}
              />

              {/* Message */}
              <Text style={s.fieldLabel}>Describe the issue <Text style={s.req}>*</Text></Text>
              <TextInput
                ref={msgRef}
                value={message}
                onChangeText={setMessage}
                placeholder="Include turf name, booking IDs, dates, and any screenshots you can email us. The more detail, the faster we resolve it."
                placeholderTextColor="#C4C9D4"
                style={s.textArea}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
              <Text style={[s.charHint, message.length >= 20 && s.charHintOk]}>
                {message.length < 20 ? `${20 - message.length} more characters needed` : "✓ Ready to send"}
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
                      <Text style={s.submitTxt}>Submit Ticket</Text>
                    </>
                }
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── FAQ — with category filter ───────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Owner Knowledge Base</Text>
          <Text style={s.sectionSub}>Answers to the most common owner questions</Text>

          {/* Category filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.faqFilterRow}>
            {faqCategories.map(f => (
              <TouchableOpacity
                key={f}
                style={[s.faqFilter, faqCat === f && s.faqFilterOn]}
                onPress={() => setFaqCat(f)}
                activeOpacity={0.7}
              >
                <Text style={[s.faqFilterTxt, faqCat === f && s.faqFilterTxtOn]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {visibleFaqs.map(group => (
            <View key={group.category} style={s.faqGroup}>
              <View style={s.faqGroupHeader}>
                <View style={s.faqGroupLine} />
                <Text style={s.faqGroupLabel}>{group.category}</Text>
                <View style={s.faqGroupLine} />
              </View>
              <View style={s.faqCard}>
                {group.items.map((item, i) => (
                  <FaqItem
                    key={i}
                    q={item.q}
                    a={item.a}
                    isLast={i === group.items.length - 1}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <View style={s.footer}>
          <View style={s.footerRow}>
            <Ionicons name="time-outline" size={13} color="#9CA3AF" />
            <Text style={s.footerTxt}>Owner support: Mon – Sat, 9 AM – 8 PM IST</Text>
          </View>
          <View style={s.footerRow}>
            <Ionicons name="shield-checkmark-outline" size={13} color="#9CA3AF" />
            <Text style={s.footerTxt}>Conversations and financials are kept strictly private</Text>
          </View>
          <View style={s.footerRow}>
            <Ionicons name="mail-outline" size={13} color="#9CA3AF" />
            <Text style={s.footerTxt}>owners@playon.app · partner@playon.app</Text>
          </View>
          <Text style={s.version}>Playon v1.0.1 · Owner Portal</Text>
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
    marginBottom: 18,
  },
  ownerBadge:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(15,118,110,0.2)", borderWidth: 1, borderColor: "rgba(15,118,110,0.3)", alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, marginBottom: 12 },
  ownerBadgeTxt: { fontSize: 12, fontWeight: "700", color: OWNER_ACCENT },
  headerTitle:   { fontSize: 28, fontWeight: "800", color: "#fff", letterSpacing: -0.5, lineHeight: 34 },
  headerSub:     { fontSize: 14, color: "#64748B", marginTop: 10, lineHeight: 21 },

  turfPill:    { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginTop: 12, backgroundColor: "rgba(15,118,110,0.15)", borderWidth: 1, borderColor: "rgba(15,118,110,0.25)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  turfPillTxt: { fontSize: 12, fontWeight: "600", color: OWNER_ACCENT },

  badgeRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  badge:    { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99 },
  badgeTxt: { fontSize: 12, fontWeight: "600", color: "#CBD5E1" },

  section:      { paddingHorizontal: 16, marginTop: 24 },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: BRAND, marginBottom: 4 },
  sectionSub:   { fontSize: 13, color: "#9CA3AF", marginBottom: 14, lineHeight: 19 },

  contactGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  contactCard: { width: "47.5%", borderRadius: 14, borderWidth: 1, padding: 14 },
  contactIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  contactLabel:{ fontSize: 14, fontWeight: "800", marginBottom: 3 },
  contactSub:  { fontSize: 11, color: "#6B7280", lineHeight: 16 },

  formCard: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 16 },

  senderPill:      { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F0FDFA", borderRadius: 10, borderWidth: 1, borderColor: "#99F6E4", padding: 12, marginBottom: 16 },
  senderAvatar:    { width: 36, height: 36, borderRadius: 10, backgroundColor: OWNER_ACCENT, alignItems: "center", justifyContent: "center" },
  senderName:      { fontSize: 13, fontWeight: "700", color: BRAND },
  senderSub:       { fontSize: 11, color: "#6B7280", marginTop: 2 },

  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 8, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.5 },
  req:        { color: "#DC2626" },

  catRow:       { gap: 8, paddingBottom: 4 },
  catChip:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  catChipOn:    { backgroundColor: BRAND, borderColor: BRAND },
  catChipUrgent:{ backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  catTxt:       { fontSize: 13, fontWeight: "600", color: "#374151" },
  catTxtOn:     { color: "#fff" },

  priorityNotice:    { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FEF2F2", borderRadius: 10, borderWidth: 1, borderColor: "#FECACA", padding: 12, marginTop: 10 },
  priorityNoticeTxt: { flex: 1, fontSize: 13, color: "#991B1B", lineHeight: 19 },

  input:    { backgroundColor: "#F9FAFB", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: BRAND },
  textArea: { backgroundColor: "#F9FAFB", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 14, color: BRAND, minHeight: 130 },

  charHint:   { fontSize: 11, color: "#9CA3AF", marginTop: 5, textAlign: "right" },
  charHintOk: { color: OWNER_ACCENT },

  submitBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: OWNER_ACCENT, borderRadius: 12, paddingVertical: 14, marginTop: 16 },
  submitBtnDim: { opacity: 0.5 },
  submitTxt:    { fontSize: 15, fontWeight: "800", color: "#fff" },

  successCard:     { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 28, alignItems: "center" },
  successIconWrap: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#F0FDFA", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  successTitle:    { fontSize: 22, fontWeight: "800", color: BRAND, marginBottom: 8 },
  successSub:      { fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 22 },
  successBtn:      { marginTop: 20, backgroundColor: "#F3F4F6", paddingHorizontal: 24, paddingVertical: 11, borderRadius: 10 },
  successBtnTxt:   { fontSize: 14, fontWeight: "700", color: BRAND },

  faqFilterRow: { gap: 8, paddingBottom: 12 },
  faqFilter:    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  faqFilterOn:  { backgroundColor: OWNER_ACCENT, borderColor: OWNER_ACCENT },
  faqFilterTxt: { fontSize: 12, fontWeight: "600", color: "#374151" },
  faqFilterTxtOn:{ color: "#fff" },

  faqGroup:       { marginBottom: 16 },
  faqGroupHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  faqGroupLine:   { flex: 1, height: 1, backgroundColor: "#E5E7EB" },
  faqGroupLabel:  { fontSize: 12, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.6 },

  faqCard:     { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  faqItem:     { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  faqItemLast: { borderBottomWidth: 0 },
  faqRow:      { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  faqDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: "#D1D5DB", marginTop: 7, flexShrink: 0 },
  faqDotOpen:  { backgroundColor: OWNER_ACCENT },
  faqQ:        { flex: 1, fontSize: 14, fontWeight: "600", color: "#374151", lineHeight: 20 },
  faqQOpen:    { color: BRAND, fontWeight: "700" },
  faqA:        { fontSize: 14, color: "#4B5563", lineHeight: 22, marginTop: 10, paddingLeft: 16 },

  footer:    { alignItems: "center", paddingHorizontal: 20, marginTop: 32, gap: 8 },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  footerTxt: { fontSize: 12, color: "#9CA3AF" },
  version:   { fontSize: 11, color: "#D1D5DB", marginTop: 8 },
});
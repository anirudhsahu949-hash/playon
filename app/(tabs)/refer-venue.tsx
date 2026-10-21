import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  StatusBar, Platform, Alert, KeyboardAvoidingView, Linking,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient"; // npx expo install expo-linear-gradient (if not already installed)
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig"; // ← adjust if this file lives somewhere other than app/refer-venue.tsx

// =============================================================================
// 🏟️ REFER A VENUE — onboarding-style referral flow
//
//   • User suggests a nearby venue PlayOn should onboard
//   • Saved as a "lead" in Firestore (venueLeads) for the team to track & work
//   • ₹500 PlayOn credit is promised *after* the venue successfully onboards —
//     NOT instantly on submit (instant reward would be exploitable). Crediting
//     that reward is an admin-side action (mark lead "onboarded" → credit
//     pcoinWallets/{referrerUserId} +500) that isn't built in this screen —
//     wire it up in your admin app + a cron step, same pattern as your
//     existing PCoin pending→credited flow.
//   • On submit, opens WhatsApp with every field pre-filled, addressed to
//     ADMIN_WHATSAPP below. Note: a plain wa.me link can't send silently —
//     WhatsApp opens with the message ready and the referrer taps Send once.
//     Fully silent, no-tap sending needs a server-side WhatsApp Business API
//     (Twilio/Gupshup) integration from server.js instead — happy to build
//     that endpoint if/when you have a WhatsApp Business API account set up.
//   • Uses react-native-safe-area-context (not the core RN SafeAreaView) so
//     the header clears the notch/status bar and the bottom action button
//     clears the Android gesture/nav bar — same pattern as your other screens.
// =============================================================================

// ── CONFIG — fill these in with your real numbers before shipping ──────────
const ADMIN_WHATSAPP   = "918055955805";      // digits only, country code, no + or spaces — used for the wa.me deep link
const PLAYON_PHONE_RAW = "+91855955805";     // used for tel: link
const PLAYON_PHONE_DISPLAY = "+91 855955805";
const PLAYON_EMAIL     = "playonsport03@playon.app";
const PLAYON_WHATSAPP_DISPLAY = "+91 80855955805";

const BRAND = "#0B1220";
const GREEN = "#22C55E";
const GREEN_DARK = "#178C42";
const GREEN_SOFT = "#DCFCE7";
const AMBER = "#F59E0B";
const BG = "#F5F5F5";
const CARD_BORDER = "#E5E7EB";
const TEXT_GRAY = "#6B7280";
const TEXT_FAINT = "#9CA3AF";

const SPORT_OPTIONS: { name: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { name: "Cricket",    icon: "baseball-outline" },
  { name: "Football",   icon: "football-outline" },
  { name: "Pickleball", icon: "tennisball-outline" },
  { name: "Badminton",  icon: "tennisball-outline" },
  { name: "Basketball", icon: "basketball-outline" },
  { name: "Volleyball", icon: "ellipse-outline" },
  { name: "Other",      icon: "ellipsis-horizontal-outline" },
];

const STEP_TITLES = ["", "Venue details", "Your details", "Review & submit", ""];

// ── Reward badge — used on the intro and success steps ─────────────────────
function RewardBadge() {
  return (
    <LinearGradient colors={["#FDE68A", AMBER]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.rewardBadge}>
      <Text style={st.rewardAmount}>₹500</Text>
      <Text style={st.rewardLabel}>PLAYON CREDIT</Text>
    </LinearGradient>
  );
}

// ── Progress bar — "Step X of 3" + a filled track ───────────────────────────
function ProgressBar({ step }: { step: number }) {
  const pct = Math.min(100, Math.max(0, (step / 3) * 100));
  return (
    <View style={st.progressWrap}>
      <View style={st.progressTrack}>
        <View style={[st.progressFill, { width: `${pct}%` }]} />
      </View>
      <Text style={st.progressLabel}>Step {step} of 3</Text>
    </View>
  );
}

// ── Input with a leading icon ───────────────────────────────────────────────
function IconInput({ icon, ...props }: { icon: keyof typeof Ionicons.glyphMap; [key: string]: any }) {
  return (
    <View style={st.inputRow}>
      <Ionicons name={icon} size={16} color={TEXT_FAINT} style={{ marginRight: 9 }} />
      <TextInput style={st.inputInner} placeholderTextColor={TEXT_FAINT} {...props} />
    </View>
  );
}

export default function ReferVenue() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0); // 0 intro, 1 venue, 2 referrer, 3 review, 4 success
  const [submitting, setSubmitting] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(null);

  const [venueName, setVenueName]     = useState("");
  const [venueLocation, setVenueLocation] = useState("");
  const [venuePhone, setVenuePhone]   = useState("");
  const [venueSports, setVenueSports] = useState<string[]>([]);
  const [reason, setReason]           = useState("");

  const [referrerName, setReferrerName]   = useState("");
  const [referrerPhone, setReferrerPhone] = useState("");

  const toggleSport = (sp: string) => {
    setVenueSports((prev) => (prev.includes(sp) ? prev.filter((s) => s !== sp) : [...prev, sp]));
  };

  const validateVenueStep = () => {
    if (!venueName.trim())     return "Enter the venue's name.";
    if (!venueLocation.trim()) return "Enter the venue's location or area.";
    if (venuePhone.trim().length < 10) return "Enter a valid venue phone number.";
    if (reason.trim().length < 10) return "Tell us a bit more — why should PlayOn add this venue?";
    return null;
  };
  const validateReferrerStep = () => {
    if (!referrerName.trim())  return "Enter your name.";
    if (referrerPhone.trim().length < 10) return "Enter a valid phone number so we can send your ₹500 reward.";
    return null;
  };

  const goNext = () => {
    const err = step === 1 ? validateVenueStep() : step === 2 ? validateReferrerStep() : null;
    if (err) { Alert.alert("Almost there", err); return; }
    setStep((s) => s + 1);
  };
  const goBack = () => {
    if (step === 0) { router.back(); return; }
    setStep((s) => s - 1);
  };

  const buildWhatsAppMessage = (id: string) =>
    `New PlayOn venue referral (#${id.slice(0, 6)})\n\n` +
    `Venue: ${venueName}\n` +
    `Location: ${venueLocation}\n` +
    `Venue phone: ${venuePhone}\n` +
    `Sports: ${venueSports.length ? venueSports.join(", ") : "-"}\n` +
    `Reason: ${reason}\n\n` +
    `Referred by: ${referrerName}\n` +
    `Referrer phone: ${referrerPhone}`;

  const openWhatsAppWithLead = (id: string) => {
    const url = `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(buildWhatsAppMessage(id))}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("WhatsApp not available", "We saved your referral, but couldn't open WhatsApp automatically. You can message us using the contact card below.");
    });
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        venueName: venueName.trim(),
        venueLocation: venueLocation.trim(),
        venuePhone: venuePhone.trim(),
        venueSports,
        reason: reason.trim(),
        referrerName: referrerName.trim(),
        referrerPhone: referrerPhone.trim(),
        referrerUserId: auth.currentUser?.uid || null,
        status: "pending", // pending → contacted → onboarded → rewarded  (or rejected)
        rewardAmount: 500,
        rewardCredited: false,
        source: "app_home_explore_more",
        platform: Platform.OS,
        createdAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, "venueLeads"), payload);
      setLeadId(docRef.id);
      openWhatsAppWithLead(docRef.id);
      setStep(4);
    } catch (e) {
      console.error("venue lead submit", e);
      Alert.alert("Something went wrong", "We couldn't save your referral. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const callPlayOn = () => Linking.openURL(`tel:${PLAYON_PHONE_RAW}`).catch(() => {});
  const emailPlayOn = () => Linking.openURL(`mailto:${PLAYON_EMAIL}`).catch(() => {});
  const whatsappPlayOn = () => Linking.openURL(`https://wa.me/${ADMIN_WHATSAPP}`).catch(() => {});

  return (
    <SafeAreaView style={st.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />

      {/* Header — clears the notch/status bar via SafeAreaView(top edge) */}
      <View style={st.header}>
        <TouchableOpacity onPress={goBack} hitSlop={10} style={st.iconBtn}>
          <Ionicons name="chevron-back" size={20} color={BRAND} />
        </TouchableOpacity>
        <View style={st.headerIconBadge}>
          <Text style={{ fontSize: 17 }}>🏟️</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle}>Refer a Venue</Text>
          {!!STEP_TITLES[step] && <Text style={st.headerSub}>{STEP_TITLES[step]}</Text>}
        </View>
      </View>
      {step > 0 && step < 4 && <ProgressBar step={step} />}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>

          {/* ── STEP 0 — Intro ── */}
          {step === 0 && (
            <View style={st.wrap}>
              <LinearGradient colors={["#FEF3C7", "#FDE68A"]} style={st.heroIconWrap}>
                <Text style={{ fontSize: 40 }}>🏟️</Text>
              </LinearGradient>
              <Text style={st.heroTitle}>Know a great venue?</Text>

              <View style={{ alignSelf: "center", marginTop: 10 }}>
                <RewardBadge />
              </View>

              <Text style={st.heroSub}>
                Suggest a turf, court, or club near you. If PlayOn successfully onboards it, this lands in your wallet.
              </Text>

              <View style={st.stepsCard}>
                {[
                  { icon: "location-outline", text: "Tell us about a venue near you" },
                  { icon: "call-outline", text: "We reach out and help them onboard" },
                  { icon: "gift-outline", text: "You get ₹500 PlayOn coin credit once they're live" },
                ].map((row, i) => (
                  <View key={i} style={st.stepRow}>
                    <View style={st.stepIconWrap}>
                      <Ionicons name={row.icon as any} size={17} color={GREEN_DARK} />
                    </View>
                    <Text style={st.stepTxt}>{row.text}</Text>
                    <View style={st.stepNum}><Text style={st.stepNumTxt}>{i + 1}</Text></View>
                  </View>
                ))}
              </View>

              <Text style={st.fineprint}>
                Reward is credited after the venue is verified and goes live on PlayOn — not instantly on submission.
              </Text>
            </View>
          )}

          {/* ── STEP 1 — Venue details ── */}
          {step === 1 && (
            <View style={st.wrap}>
              <Field label="Venue name">
                <IconInput icon="business-outline" value={venueName} onChangeText={setVenueName}
                  placeholder="e.g. Green Park Turf" maxLength={60} />
              </Field>
              <Field label="Location / area">
                <IconInput icon="location-outline" value={venueLocation} onChangeText={setVenueLocation}
                  placeholder="e.g. Camp Road, Amravati" maxLength={80} />
              </Field>
              <Field label="Venue phone number">
                <IconInput icon="call-outline" value={venuePhone} onChangeText={setVenuePhone}
                  placeholder="10-digit number" keyboardType="phone-pad" maxLength={15} />
              </Field>
              <Field label="Sports played there (optional)">
                <View style={st.chipRow}>
                  {SPORT_OPTIONS.map((sp) => {
                    const on = venueSports.includes(sp.name);
                    return (
                      <TouchableOpacity key={sp.name} style={[st.chip, on && st.chipOn]} onPress={() => toggleSport(sp.name)}>
                        <Ionicons name={sp.icon} size={13} color={on ? "#fff" : TEXT_GRAY} />
                        <Text style={[st.chipTxt, on && st.chipTxtOn]}>{sp.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Field>
              <Field label="Why should PlayOn add this venue?">
                <TextInput
                  style={st.textarea} value={reason} onChangeText={setReason}
                  placeholder="e.g. Great turf, always busy, no online booking option yet..."
                  placeholderTextColor={TEXT_FAINT} multiline numberOfLines={4} maxLength={300}
                />
              </Field>
            </View>
          )}

          {/* ── STEP 2 — Referrer details ── */}
          {step === 2 && (
            <View style={st.wrap}>
              <Field label="Your name">
                <IconInput icon="person-outline" value={referrerName} onChangeText={setReferrerName}
                  placeholder="Your full name" maxLength={50} />
              </Field>
              <Field label="Your phone number">
                <IconInput icon="call-outline" value={referrerPhone} onChangeText={setReferrerPhone}
                  placeholder="So we can reach you about your ₹500 reward"
                  keyboardType="phone-pad" maxLength={15} />
              </Field>
              <View style={st.noteCard}>
                <Ionicons name="information-circle-outline" size={16} color={TEXT_GRAY} />
                <Text style={st.noteTxt}>By submitting, you agree PlayOn may contact you and the venue about this referral.</Text>
              </View>
            </View>
          )}

          {/* ── STEP 3 — Review + contact info + submit ── */}
          {step === 3 && (
            <View style={st.wrap}>
              <View style={st.summaryCard}>
                <Text style={st.summaryTitle}>{venueName}</Text>
                <SummaryRow icon="location-outline" text={venueLocation} />
                <SummaryRow icon="call-outline" text={venuePhone} />
                {venueSports.length > 0 && <SummaryRow icon="football-outline" text={venueSports.join(", ")} />}
                <View style={st.summaryDivider} />
                <Text style={st.summaryReason} numberOfLines={4}>"{reason}"</Text>
                <View style={st.summaryDivider} />
                <SummaryRow icon="person-outline" text={`${referrerName} · ${referrerPhone}`} />
              </View>

              <Text style={st.contactHeading}>Prefer to reach us directly?</Text>
              <View style={st.contactCard}>
                <ContactRow icon="call-outline" label={PLAYON_PHONE_DISPLAY} onPress={callPlayOn} />
                <ContactRow icon="mail-outline" label={PLAYON_EMAIL} onPress={emailPlayOn} />
                <ContactRow icon="logo-whatsapp" label={PLAYON_WHATSAPP_DISPLAY} onPress={whatsappPlayOn} last />
              </View>
            </View>
          )}

          {/* ── STEP 4 — Success ── */}
          {step === 4 && (
            <View style={st.wrap}>
              <LinearGradient colors={[GREEN_SOFT, "#BBF7D0"]} style={st.heroIconWrap}>
                <Ionicons name="checkmark-circle" size={44} color={GREEN_DARK} />
              </LinearGradient>
              <Text style={st.heroTitle}>Referral submitted!</Text>

              <View style={{ alignSelf: "center", marginTop: 10 }}>
                <RewardBadge />
              </View>

              <Text style={st.heroSub}>
                We'll reach out to {venueName || "the venue"} soon. Once they're successfully onboarded, this credit lands in your wallet.
              </Text>
              {!!leadId && <Text style={st.leadIdTxt}>Reference ID: {leadId.slice(0, 8).toUpperCase()}</Text>}

              <TouchableOpacity style={st.secondaryBtn} onPress={() => leadId && openWhatsAppWithLead(leadId)} activeOpacity={0.85}>
                <Ionicons name="logo-whatsapp" size={18} color={GREEN_DARK} />
                <Text style={st.secondaryBtnTxt}>Message us on WhatsApp</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom action bar — clears the Android gesture/nav bar via insets.bottom */}
      {step < 4 && (
        <View style={[st.bottomBar, { paddingBottom: 14 + insets.bottom }]}>
          <TouchableOpacity
            style={[st.primaryBtn, submitting && { opacity: 0.7 }]}
            activeOpacity={0.9}
            disabled={submitting}
            onPress={step === 0 ? () => setStep(1) : step === 3 ? handleSubmit : goNext}
          >
            <Text style={st.primaryBtnTxt}>
              {step === 0 ? "Get Started" : step === 3 ? (submitting ? "Submitting…" : "Submit Referral") : "Next"}
            </Text>
            {!submitting && <Ionicons name="arrow-forward" size={17} color="#fff" />}
          </TouchableOpacity>
        </View>
      )}
      {step === 4 && (
        <View style={[st.bottomBar, { paddingBottom: 14 + insets.bottom }]}>
          <TouchableOpacity style={st.primaryBtn} activeOpacity={0.9} onPress={() => router.push("/(tabs)")}>
            <Text style={st.primaryBtnTxt}>Done</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={st.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function SummaryRow({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={st.summaryRow}>
      <Ionicons name={icon} size={14} color={TEXT_GRAY} />
      <Text style={st.summaryRowTxt} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function ContactRow({ icon, label, onPress, last }: { icon: any; label: string; onPress: () => void; last?: boolean }) {
  return (
    <TouchableOpacity style={[st.contactRow, !last && st.contactRowBorder]} onPress={onPress} activeOpacity={0.7}>
      <View style={st.contactIconWrap}><Ionicons name={icon} size={16} color={GREEN_DARK} /></View>
      <Text style={st.contactLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={TEXT_FAINT} />
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 10 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#fff", borderWidth: 1, borderColor: CARD_BORDER, alignItems: "center", justifyContent: "center" },
  headerIconBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "800", color: BRAND },
  headerSub: { fontSize: 11.5, color: TEXT_GRAY, marginTop: 1 },

  progressWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: "#E5E7EB", overflow: "hidden" },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: GREEN },
  progressLabel: { fontSize: 11, color: TEXT_FAINT, fontWeight: "700", marginTop: 6 },

  scroll: { paddingBottom: 40 },
  wrap: { paddingHorizontal: 18, paddingTop: 14 },

  heroIconWrap: { width: 84, height: 84, borderRadius: 24, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 14 },
  heroTitle: { fontSize: 21, fontWeight: "900", color: BRAND, textAlign: "center", letterSpacing: -0.3 },
  heroSub: { fontSize: 13.5, color: TEXT_GRAY, textAlign: "center", marginTop: 14, lineHeight: 19, paddingHorizontal: 8 },

  rewardBadge: { alignItems: "center", paddingHorizontal: 22, paddingVertical: 10, borderRadius: 16 },
  rewardAmount: { fontSize: 22, fontWeight: "900", color: "#78350F" },
  rewardLabel: { fontSize: 9.5, fontWeight: "800", color: "#78350F", letterSpacing: 1, marginTop: 1 },

  stepsCard: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: CARD_BORDER, padding: 14, marginTop: 22 },
  stepRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 10 },
  stepIconWrap: { width: 34, height: 34, borderRadius: 12, backgroundColor: GREEN_SOFT, alignItems: "center", justifyContent: "center" },
  stepTxt: { fontSize: 13, color: BRAND, fontWeight: "600", flex: 1 },
  stepNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  stepNumTxt: { fontSize: 10.5, fontWeight: "800", color: TEXT_GRAY },

  fineprint: { fontSize: 11.5, color: TEXT_FAINT, textAlign: "center", marginTop: 18, lineHeight: 16, paddingHorizontal: 12 },

  fieldLabel: { fontSize: 12.5, fontWeight: "700", color: BRAND, marginBottom: 6 },
  inputRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: CARD_BORDER, paddingHorizontal: 14 },
  inputInner: { flex: 1, paddingVertical: 12, fontSize: 14, color: BRAND },
  textarea: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: CARD_BORDER, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: BRAND, minHeight: 90, textAlignVertical: "top" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 99, borderWidth: 1.5, borderColor: CARD_BORDER, backgroundColor: "#fff" },
  chipOn: { backgroundColor: GREEN, borderColor: GREEN },
  chipTxt: { fontSize: 12.5, fontWeight: "700", color: BRAND },
  chipTxtOn: { color: "#fff" },

  noteCard: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#F3F4F6", borderRadius: 12, padding: 12, marginTop: 6 },
  noteTxt: { fontSize: 11.5, color: TEXT_GRAY, flex: 1, lineHeight: 16 },

  summaryCard: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: CARD_BORDER, padding: 16 },
  summaryTitle: { fontSize: 16, fontWeight: "900", color: BRAND, marginBottom: 8 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  summaryRowTxt: { fontSize: 13, color: TEXT_GRAY, flex: 1 },
  summaryDivider: { height: 1, backgroundColor: CARD_BORDER, marginVertical: 10 },
  summaryReason: { fontSize: 13, color: BRAND, fontStyle: "italic", lineHeight: 18 },

  contactHeading: { fontSize: 13, fontWeight: "800", color: BRAND, marginTop: 22, marginBottom: 10 },
  contactCard: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: CARD_BORDER, overflow: "hidden" },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  contactRowBorder: { borderBottomWidth: 1, borderBottomColor: CARD_BORDER },
  contactIconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: GREEN_SOFT, alignItems: "center", justifyContent: "center" },
  contactLabel: { fontSize: 13.5, fontWeight: "700", color: BRAND, flex: 1 },

  leadIdTxt: { fontSize: 11.5, color: TEXT_FAINT, textAlign: "center", marginTop: 14, letterSpacing: 0.5 },

  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: GREEN_SOFT, borderRadius: 12, paddingVertical: 13, marginTop: 22 },
  secondaryBtnTxt: { fontSize: 13.5, fontWeight: "800", color: GREEN_DARK },

  bottomBar: { paddingHorizontal: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: CARD_BORDER, backgroundColor: BG },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: GREEN_DARK, borderRadius: 14, paddingVertical: 15 },
  primaryBtnTxt: { color: "#fff", fontWeight: "900", fontSize: 15 },
});
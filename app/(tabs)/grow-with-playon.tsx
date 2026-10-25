/**
 * app/grow-with-playon.tsx — "Grow with PlayOn"
 * Explains the two ways a turf can join PlayOn (free Listing vs online Booking)
 * and sends the owner to the List Your Turf form.
 * Opened from the owner card + "List Your Turf" tile on the user home screen.
 * Works for guests (no login needed).
 */
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, StatusBar, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

const GREEN = "#0E6B37";
const DARK = "#0B1220";
const LIME = "#B9F24C";
const PLAYON_PHONE = "9890844206";

const LISTING_POINTS = [
  "Price, timings and facilities on your turf page",
  "\"Call to Book\" button with your number",
  "No app to manage — keep booking the way you do now",
];
const BOOKING_POINTS = [
  "Live slots, online payment, daily settlement",
  "Block slots, offline bookings, offers, customers",
  "Start with Listing, upgrade any time",
];
const STEPS = [
  "Fill the form with your turf details",
  "Send it to PlayOn on WhatsApp",
  "Our team asks for turf photos on WhatsApp",
  "After approval, your turf goes live",
];

function Point({ text }: { text: string }) {
  return (
    <View style={s.pointRow}>
      <Ionicons name="checkmark" size={16} color={GREEN} style={{ marginTop: 1 }} />
      <Text style={s.pointTxt}>{text}</Text>
    </View>
  );
}

export default function GrowWithPlayOn() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={GREEN} />

      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Grow with PlayOn</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
        <View style={s.intro}>
          <Text style={s.introTitle}>Bring more players to your turf</Text>
          <Text style={s.introSub}>
            Players in your city search PlayOn every day. Choose how you want them to book you.
          </Text>
        </View>

        {/* ── Turf Listing (free) ── */}
        <View style={[s.planCard, s.planCardActive]}>
          <View style={s.planHead}>
            <View style={s.planTitleRow}>
              <View style={[s.planIcon, { backgroundColor: "#E3F2E7" }]}>
                <Ionicons name="call-outline" size={20} color={GREEN} />
              </View>
              <Text style={s.planTitle}>Turf Listing</Text>
            </View>
            <View style={[s.pill, { backgroundColor: LIME }]}>
              <Text style={[s.pillTxt, { color: DARK }]}>FREE</Text>
            </View>
          </View>
          <Text style={s.planSub}>Your turf shows on PlayOn. Players call you and book directly with you.</Text>
          {LISTING_POINTS.map((p) => <Point key={p} text={p} />)}
        </View>

        {/* ── Turf Booking (online) ── */}
        <View style={s.planCard}>
          <View style={s.planHead}>
            <View style={s.planTitleRow}>
              <View style={[s.planIcon, { backgroundColor: DARK }]}>
                <Ionicons name="calendar-outline" size={20} color={LIME} />
              </View>
              <Text style={s.planTitle}>Turf Booking</Text>
            </View>
            <View style={[s.pill, { backgroundColor: "#EEF1EE" }]}>
              <Text style={[s.pillTxt, { color: "#3C4A41" }]}>ONLINE</Text>
            </View>
          </View>
          <Text style={s.planSub}>Players see your free slots and pay online. You manage everything in the PlayOn owner app.</Text>
          {BOOKING_POINTS.map((p) => <Point key={p} text={p} />)}
        </View>

        {/* ── How it works ── */}
        <Text style={s.howTitle}>How listing works</Text>
        <View style={s.stepsCard}>
          {STEPS.map((t, i) => (
            <View key={t} style={s.stepRow}>
              <View style={s.stepNum}><Text style={s.stepNumTxt}>{i + 1}</Text></View>
              <Text style={s.stepTxt}>{t}</Text>
            </View>
          ))}
        </View>

        {/* ── CTA ── */}
        <TouchableOpacity style={s.cta} onPress={() => router.push("/list-turf" as any)} activeOpacity={0.88}>
          <Text style={s.ctaTxt}>List my turf — Free</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL(`tel:${PLAYON_PHONE}`)} activeOpacity={0.7}>
          <Text style={s.helpTxt}>Questions? Call or WhatsApp 98908 44206</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F3F6F2" },
  header: { backgroundColor: GREEN, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingBottom: 12 },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#fff" },

  intro: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  introTitle: { fontSize: 26, fontWeight: "900", color: "#13221A", lineHeight: 32 },
  introSub: { fontSize: 14, color: "#4C5C52", lineHeight: 21, marginTop: 8 },

  planCard: { backgroundColor: "#fff", marginHorizontal: 16, marginTop: 14, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: "#DCE4DE", gap: 10 },
  planCardActive: { borderWidth: 2, borderColor: GREEN },
  planHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  planTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  planIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  planTitle: { fontSize: 18, fontWeight: "900", color: "#13221A" },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  pillTxt: { fontSize: 12, fontWeight: "800" },
  planSub: { fontSize: 13, color: "#4C5C52", lineHeight: 19 },
  pointRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  pointTxt: { flex: 1, fontSize: 13, color: "#13221A", lineHeight: 18 },

  howTitle: { fontSize: 16, fontWeight: "900", color: "#13221A", marginHorizontal: 16, marginTop: 24, marginBottom: 10 },
  stepsCard: { backgroundColor: "#fff", marginHorizontal: 16, borderRadius: 16, padding: 16, gap: 14, borderWidth: 1, borderColor: "#E2E8E3" },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  stepNumTxt: { color: "#fff", fontWeight: "900", fontSize: 14 },
  stepTxt: { flex: 1, fontSize: 14, color: "#13221A" },

  cta: { backgroundColor: GREEN, marginHorizontal: 16, marginTop: 24, height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  ctaTxt: { color: "#fff", fontSize: 16, fontWeight: "900" },
  helpTxt: { textAlign: "center", fontSize: 12, color: "#5B6B61", marginTop: 12, paddingVertical: 6 },
});

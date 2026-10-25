/**
 * app/add-a-turf.tsx — "Add a Turf" chooser (one entry point for everyone).
 *
 * Opened from the "Add a Turf" strip at the bottom of the Home screen.
 *  • I own or manage this turf → /grow-with-playon (Turf Listing free /
 *    Turf Booking online plans) → owner form in list-turf.tsx
 *  • I'm a player              → list-turf.tsx in player mode (?as=player)
 * Both end up in Firestore "turfRequests" and the admin Turf Requests screen.
 *
 * This file uses no Firebase, so it can live at the app root (outside the
 * (tabs) folder) and won't add a tab to the tab bar.
 */
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, StatusBar,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

// Routes of the two existing screens. If your list-turf file lives in a
// different folder, change LIST_TURF_ROUTE to match (e.g. "/owner/list-turf").
const GROW_ROUTE = "/grow-with-playon";
const LIST_TURF_ROUTE = "/list-turf";

const BRAND = "#0B1220";
const GREEN = "#15803D";
const MUTED = "#4B5563";

function Choice({
  icon, iconBg, iconColor, title, sub, tags, onPress, label,
}: {
  icon: keyof typeof Ionicons.glyphMap; iconBg: string; iconColor: string;
  title: string; sub: string; tags: string[]; onPress: () => void; label: string;
}) {
  return (
    <TouchableOpacity style={s.choice} onPress={onPress} activeOpacity={0.88}
      accessibilityRole="button" accessibilityLabel={label}>
      <View style={[s.choiceIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={26} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.choiceTitle}>{title}</Text>
        <Text style={s.choiceSub}>{sub}</Text>
        <View style={s.tagRow}>
          {tags.map((t) => (
            <View key={t} style={s.tag}><Text style={s.tagTxt}>{t}</Text></View>
          ))}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={MUTED} />
    </TouchableOpacity>
  );
}

export default function AddATurf() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F5" />
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={BRAND} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Add a Turf</Text>
          <Text style={s.sub}>Put a turf or court on PlayOn</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 14 }}>
        <Text style={s.question}>Who are you?</Text>

        <Choice
          icon="business"
          iconBg="#0B1220"
          iconColor="#22C55E"
          title="I own or manage this turf"
          sub="List it free so players call you, or get online bookings and payments."
          tags={["Free listing", "Online booking"]}
          label="I own or manage this turf"
          onPress={() => router.push(GROW_ROUTE as any)}
        />

        <Choice
          icon="people"
          iconBg="#DCFCE7"
          iconColor={GREEN}
          title="I'm a player"
          sub="Add a turf you know so other players can find it and call to book."
          tags={["Takes 2 min", "No owner needed"]}
          label="I'm a player, add a turf I know"
          onPress={() => router.push({ pathname: LIST_TURF_ROUTE, params: { as: "player" } } as any)}
        />

        <View style={s.note}>
          <Ionicons name="shield-checkmark-outline" size={18} color={GREEN} />
          <Text style={s.noteTxt}>
            The PlayOn team checks every turf before it goes live. Photos can be sent on WhatsApp after you submit.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#F5F5F5" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingBottom: 12 },
  backBtn:{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  title:  { fontSize: 20, fontWeight: "900", color: BRAND },
  sub:    { fontSize: 12.5, color: MUTED, marginTop: 1 },

  question: { fontSize: 15, fontWeight: "800", color: BRAND, marginTop: 4 },

  choice:      { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  choiceIcon:  { width: 54, height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  choiceTitle: { fontSize: 16, fontWeight: "900", color: BRAND },
  choiceSub:   { fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 18 },
  tagRow:      { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  tag:         { backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  tagTxt:      { fontSize: 11.5, fontWeight: "700", color: GREEN },

  note:    { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "#fff", borderRadius: 14, padding: 14, marginTop: 6 },
  noteTxt: { flex: 1, fontSize: 12.5, color: MUTED, lineHeight: 18 },
});

import React from "react";
import {
  View, Text, StyleSheet, Modal, ScrollView,
  TouchableOpacity, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { inviteFriend } from "../match-tools/Shareinvite";

// =============================================================================
// 📖 HelpGuideSheet — the "how do I use this app?" guide.
// Opens from the ☰ menu button on the Leagues home header (which previously
// did NOTHING — bug fixed). Walks a new user through:
//   1. Create account → 2. Host a match → 3. Host a league →
//   4. Score live → 5. Share & invite friends
// Every step has a button that takes them straight to that screen.
// =============================================================================

const GREEN = "#16A34A";
const DARK  = "#0B1220";
const GRAY  = "#9AA3B2";

type Step = {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  desc: string;
  cta?: { label: string; route?: string; action?: "invite" };
};

const STEPS: Step[] = [
  {
    icon: "person-add",
    color: "#3B82F6",
    title: "1 · Create your player profile",
    desc: "Sign in and set up your player profile — your name, photo and favourite sport. Your stats build up automatically as you play matches.",
    cta: { label: "Edit my profile", route: "/(playon-pro)/edit-player-profile" },
  },
  {
    icon: "flash",
    color: "#F59E0B",
    title: "2 · Host a quick match",
    desc: "Playing today? Create a one-off match in 30 seconds — two team names, a sport and a time. No league needed. You become the scorer.",
    cta: { label: "Host a match", route: "/(playon-pro)/host-match" },
  },
  {
    icon: "trophy",
    color: GREEN,
    title: "3 · Host your own league",
    desc: "Running a tournament? Create a league, add teams and players, generate fixtures (round robin / knockout) and the points table updates itself.",
    cta: { label: "Create a league", route: "/(playon-pro)/create-league" },
  },
  {
    icon: "radio",
    color: "#E11D2A",
    title: "4 · Score matches LIVE",
    desc: "Open your match from Home → tap it → update the score ball by ball. Everyone watching sees it update in real time, with a live viewer count.",
  },
  {
    icon: "share-social",
    color: "#8B5CF6",
    title: "5 · Invite friends & share scores",
    desc: "Share any live match or league on WhatsApp. Friends can watch the score live and see who's leading the points table.",
    cta: { label: "Invite a friend", action: "invite" },
  },
];

export default function HelpGuideSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const go = (step: Step) => {
    if (step.cta?.action === "invite") { inviteFriend(); return; }
    if (step.cta?.route) {
      onClose();
      setTimeout(() => router.push(step.cta!.route as any), 250);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={st.root}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />

        {/* Header */}
        <View style={st.header}>
          <View style={st.trophy}><Ionicons name="book" size={16} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.title}>How Playon Leagues works</Text>
            <Text style={st.sub}>Host · Score · Watch · Share</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={st.closeBtn} hitSlop={10}>
            <Ionicons name="close" size={22} color={DARK} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {STEPS.map((step, i) => (
            <View key={i} style={st.card}>
              <View style={[st.iconWrap, { backgroundColor: step.color + "1A" }]}>
                <Ionicons name={step.icon} size={20} color={step.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.stepTitle}>{step.title}</Text>
                <Text style={st.stepDesc}>{step.desc}</Text>
                {step.cta && (
                  <TouchableOpacity style={st.cta} onPress={() => go(step)} activeOpacity={0.85}>
                    <Text style={st.ctaTxt}>{step.cta.label}</Text>
                    <Ionicons name="arrow-forward" size={13} color={GREEN} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}

          {/* Tip box */}
          <View style={st.tipBox}>
            <Ionicons name="bulb" size={16} color="#F59E0B" />
            <Text style={st.tipTxt}>
              Tip: the more people you invite, the more live viewers your matches
              get — everyone can see how many are watching!
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F0F1F5" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 14 : 54,
    paddingBottom: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  trophy: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: GREEN, alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 16, fontWeight: "800", color: DARK },
  sub:   { fontSize: 11, color: GRAY, fontWeight: "600", marginTop: 1 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "#F5F6F8", alignItems: "center", justifyContent: "center",
  },

  card: {
    flexDirection: "row", gap: 12,
    backgroundColor: "#fff", borderRadius: 16,
    padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: "#EDEEF2",
  },
  iconWrap: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  stepTitle: { fontSize: 14, fontWeight: "800", color: DARK, marginBottom: 4 },
  stepDesc:  { fontSize: 12.5, color: "#6B7280", lineHeight: 18 },
  cta: {
    flexDirection: "row", alignItems: "center", gap: 5,
    marginTop: 10, alignSelf: "flex-start",
    backgroundColor: "#DCFCE7", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  ctaTxt: { fontSize: 12, fontWeight: "800", color: GREEN },

  tipBox: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    backgroundColor: "#FFFBEB", borderRadius: 14,
    borderWidth: 1, borderColor: "#FDE68A",
    padding: 14, marginTop: 4,
  },
  tipTxt: { flex: 1, fontSize: 12, color: "#92400E", lineHeight: 17, fontWeight: "600" },
});
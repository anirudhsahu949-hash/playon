import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { db, auth } from "../../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { getIdToken } from "firebase/auth";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import TeamAvatar from "../../components/Teamavatar";

// =============================================================================
// ⚡ MANAGE MATCH — organizer control screen for a single quick match
// Quick matches have no league (leagueId: null), so they don't show up in
// league-manage. This is their equivalent: view details, and either jump
// into the real cricket scorer, or update the score directly for every
// other sport (a lightweight stand-in until the full universal scorer ships).
// =============================================================================

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

const GREEN   = "#16A34A";
const GREEN_D = "#15803D";
const RED     = "#E11D2A";
const DARK    = "#0B1220";
const PAGE_BG = "#F0F1F5";
const GRAY    = "#9AA3B2";

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  scheduled: { label: "SCHEDULED", color: "#2563EB", bg: "#EFF6FF" },
  live:      { label: "LIVE",      color: RED,        bg: "#FEF2F2" },
  completed: { label: "COMPLETED", color: GRAY,        bg: "#F3F4F6" },
  finished:  { label: "COMPLETED", color: GRAY,        bg: "#F3F4F6" },
};

const STATUS_OPTIONS: { key: string; label: string }[] = [
  { key: "scheduled", label: "Scheduled" },
  { key: "live",      label: "Live" },
  { key: "completed", label: "Completed" },
];

type MatchDoc = {
  leagueId: string | null;
  leagueName: string;
  teamAName: string; teamBName: string;
  teamAIconName?: string | null; teamAIconColor?: string | null;
  teamBIconName?: string | null; teamBIconColor?: string | null;
  sport: string;
  date: string; startTime: string; endTime: string; venue: string;
  status: string; scoreA: number; scoreB: number; liveSummary: string;
  organizerId: string;
};

async function getAuthToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await getIdToken(user);
  } catch {
    return null;
  }
}

export default function ManageMatch() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [match, setMatch]           = useState<MatchDoc | null>(null);
  const [notOwner, setNotOwner]     = useState(false);

  const [scoreA, setScoreA]         = useState("0");
  const [scoreB, setScoreB]         = useState("0");
  const [status, setStatus]         = useState("scheduled");
  const [liveSummary, setLiveSummary] = useState("");
  const [saving, setSaving]         = useState(false);

  const uid = auth.currentUser?.uid || null;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const snap = await getDoc(doc(db, "leagueMatches", id));
      if (!snap.exists()) { setLoading(false); return; }
      const m = snap.data() as MatchDoc;

      if (uid !== m.organizerId) {
        setMatch(m);
        setNotOwner(true);
        setLoading(false);
        return;
      }
      setNotOwner(false);
      setMatch(m);
      setScoreA(String(m.scoreA ?? 0));
      setScoreB(String(m.scoreB ?? 0));
      setStatus(m.status || "scheduled");
      setLiveSummary(m.liveSummary || "");
    } catch (e) {
      console.error("manage-match load:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, uid]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  const saveScore = async () => {
    const sA = Number(scoreA), sB = Number(scoreB);
    if (isNaN(sA) || isNaN(sB) || sA < 0 || sB < 0) {
      return Alert.alert("Invalid score", "Scores must be 0 or more.");
    }
    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) { setSaving(false); return Alert.alert("Not signed in", "Please log in again."); }

      const res = await fetch(`${SERVER_URL}/update-match-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          matchId: id, scoreA: sA, scoreB: sB, status, liveSummary: liveSummary.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Could not update the score.");

      Alert.alert("Saved", "Score updated.");
      load();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />
        <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
      </SafeAreaView>
    );
  }

  if (!match) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />
        <View style={s.center}>
          <Ionicons name="flash-outline" size={36} color={GRAY} />
          <Text style={s.notFoundTxt}>Match not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={{ color: GREEN, fontWeight: "700" }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // A league match wandered in here by mistake — send them to the right screen.
  if (match.leagueId) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />
        <View style={s.center}>
          <Ionicons name="trophy-outline" size={36} color={GRAY} />
          <Text style={s.notFoundTxt}>This match belongs to a league</Text>
          <Text style={s.notFoundSub}>Manage it from the league's Matches tab instead.</Text>
          <TouchableOpacity
            onPress={() => router.replace({ pathname: "/(playon-pro)/league-manage", params: { id: match.leagueId! } } as any)}
            style={{ marginTop: 12 }}
          >
            <Text style={{ color: GREEN, fontWeight: "700" }}>Go to league</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (notOwner) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />
        <View style={s.center}>
          <Ionicons name="lock-closed-outline" size={36} color={GRAY} />
          <Text style={s.notFoundTxt}>You don't manage this match</Text>
          <Text style={s.notFoundSub}>Only the person who hosted it can update the score.</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={{ color: GREEN, fontWeight: "700" }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const statusCfg = STATUS_CFG[match.status] || STATUS_CFG.scheduled;
  const isCricket = (match.sport || "").toLowerCase() === "cricket";

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{match.teamAName} vs {match.teamBName}</Text>
          <Text style={s.headerSub}>Manage match</Text>
        </View>
        <View style={[s.statusPill, { backgroundColor: statusCfg.bg }]}>
          <Text style={[s.statusTxt, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
        >
          {/* Teams card */}
          <View style={mc.teamsCard}>
            <View style={mc.teamSide}>
              <TeamAvatar name={match.teamAName} iconName={match.teamAIconName} iconColor={match.teamAIconColor} size={54} />
              <Text style={mc.teamName} numberOfLines={1}>{match.teamAName}</Text>
              <Text style={mc.teamScore}>{match.scoreA}</Text>
            </View>
            <Text style={mc.vsTxt}>VS</Text>
            <View style={mc.teamSide}>
              <TeamAvatar name={match.teamBName} iconName={match.teamBIconName} iconColor={match.teamBIconColor} size={54} />
              <Text style={mc.teamName} numberOfLines={1}>{match.teamBName}</Text>
              <Text style={mc.teamScore}>{match.scoreB}</Text>
            </View>
          </View>

          {/* Details card */}
          <View style={mc.detailsCard}>
            <DetailRow icon="baseball-outline" label="Sport" value={match.sport} />
            <DetailRow icon="calendar-outline" label="Date" value={match.date || "TBD"} />
            {!!(match.startTime || match.endTime) && (
              <DetailRow icon="time-outline" label="Time" value={[match.startTime, match.endTime].filter(Boolean).join(" – ")} />
            )}
            {!!match.venue && <DetailRow icon="location-outline" label="Venue" value={match.venue} />}
          </View>

          {isCricket ? (
            <>
              <View style={mc.nudge}>
                <Ionicons name="baseball" size={18} color={GREEN_D} />
                <Text style={mc.nudgeTxt}>Cricket matches use the full ball-by-ball scorer.</Text>
              </View>
              <TouchableOpacity
                style={mc.scorerBtn}
                activeOpacity={0.85}
                onPress={() => router.push(`/(playon-pro)/score/${id}` as any)}
              >
                <Ionicons name="stats-chart" size={18} color="#fff" />
                <Text style={mc.scorerBtnTxt}>
                  {match.status === "live" ? "Resume Scoring" : match.status === "scheduled" ? "Start Scoring" : "View Scorecard"}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={mc.formCard}>
              <Text style={mc.formTitle}>Update score</Text>

              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={mc.label}>{match.teamAName}</Text>
                  <TextInput
                    style={mc.scoreInput}
                    value={scoreA}
                    onChangeText={(v) => setScoreA(v.replace(/[^0-9]/g, ""))}
                    keyboardType="number-pad"
                    maxLength={4}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={mc.label}>{match.teamBName}</Text>
                  <TextInput
                    style={mc.scoreInput}
                    value={scoreB}
                    onChangeText={(v) => setScoreB(v.replace(/[^0-9]/g, ""))}
                    keyboardType="number-pad"
                    maxLength={4}
                  />
                </View>
              </View>

              <Text style={mc.label}>Match status</Text>
              <View style={mc.statusRow}>
                {STATUS_OPTIONS.map((opt) => {
                  const active = status === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[mc.statusChip, active && mc.statusChipActive]}
                      onPress={() => setStatus(opt.key)}
                      activeOpacity={0.8}
                    >
                      <Text style={[mc.statusChipTxt, active && mc.statusChipTxtActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={mc.label}>Live summary (optional)</Text>
              <TextInput
                style={mc.input}
                value={liveSummary}
                onChangeText={setLiveSummary}
                placeholder="e.g. 2nd half, 10 mins left"
                placeholderTextColor={GRAY}
                maxLength={80}
              />

              <TouchableOpacity
                style={[mc.saveBtn, saving && { opacity: 0.7 }]}
                onPress={saveScore}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={mc.saveBtnTxt}>Save Score</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DetailRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={mc.detailRow}>
      <Ionicons name={icon} size={16} color={GRAY} style={{ width: 22 }} />
      <Text style={mc.detailLabel}>{label}</Text>
      <Text style={mc.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE_BG },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 6 },
  notFoundTxt: { fontSize: 15, fontWeight: "700", color: DARK, marginTop: 8, textAlign: "center" },
  notFoundSub: { fontSize: 13, color: GRAY, textAlign: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 8,
    paddingBottom: 12, backgroundColor: PAGE_BG,
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: DARK },
  headerSub: { fontSize: 12, color: GRAY, marginTop: 1 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 },
  statusTxt: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.3 },
});

const mc = StyleSheet.create({
  teamsCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#fff", borderRadius: 16, padding: 18, marginBottom: 14,
  },
  teamSide: { flex: 1, alignItems: "center", gap: 8 },
  teamName: { fontSize: 13.5, fontWeight: "700", color: DARK, textAlign: "center" },
  teamScore: { fontSize: 26, fontWeight: "900", color: DARK },
  vsTxt: { fontSize: 12, fontWeight: "800", color: GRAY, paddingHorizontal: 6 },

  detailsCard: { backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 14 },
  detailRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  detailLabel: { flex: 1, fontSize: 13, color: GRAY, fontWeight: "600" },
  detailValue: { flex: 1.4, fontSize: 13.5, color: DARK, fontWeight: "700", textAlign: "right" },

  nudge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F0FDF4", borderRadius: 12, padding: 12, marginBottom: 12,
  },
  nudgeTxt: { flex: 1, fontSize: 12.5, color: GREEN_D, fontWeight: "600" },
  scorerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GREEN, borderRadius: 14, paddingVertical: 15,
  },
  scorerBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },

  formCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16 },
  formTitle: { fontSize: 15, fontWeight: "800", color: DARK, marginBottom: 12 },
  label: { fontSize: 12.5, fontWeight: "700", color: DARK, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: "#F9FAFB", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB",
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: DARK,
  },
  scoreInput: {
    backgroundColor: "#F9FAFB", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB",
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 20, fontWeight: "800", color: DARK, textAlign: "center",
  },
  statusRow: { flexDirection: "row", gap: 8 },
  statusChip: {
    flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10,
    backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB",
  },
  statusChipActive: { backgroundColor: GREEN, borderColor: GREEN },
  statusChipTxt: { fontSize: 12.5, fontWeight: "700", color: "#6B7280" },
  statusChipTxtActive: { color: "#fff" },

  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GREEN, borderRadius: 12, paddingVertical: 14, marginTop: 18,
  },
  saveBtnTxt: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
});
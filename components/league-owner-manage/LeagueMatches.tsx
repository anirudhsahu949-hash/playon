import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView,
} from "react-native";
import { useState } from "react";
import { auth } from "../../firebaseConfig";
import { getIdToken } from "firebase/auth";
import { Ionicons } from "@expo/vector-icons";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

const PRIMARY    = "#5B4FE5";
const PRIMARY_BG = "#F0EEFF";
const DARK       = "#1B2050";
const MUTED      = "#8A8FA8";
const GREEN      = "#16A34A";
const BORDER     = "#EEF0F7";
const BG         = "#F7F8FC";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MATCH_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  scheduled: { label: "Scheduled", color: "#2563EB", bg: "#EFF6FF" },
  live:      { label: "● LIVE",    color: GREEN,      bg: "#F0FDF4" },
  completed: { label: "Final",     color: MUTED,       bg: "#F3F4F6" },
};

async function getAuthToken(): Promise<string | null> {
  try {
    const u = auth.currentUser;
    return u ? await getIdToken(u) : null;
  } catch { return null; }
}

export default function LeagueMatches({
  leagueId, teams, matches, router,
}: { leagueId: string; league: any; teams: any[]; matches: any[]; router: any }) {
  const [showForm, setShowForm] = useState(false);
  const [mTeamA, setMTeamA] = useState("");
  const [mTeamB, setMTeamB] = useState("");
  const [mDate, setMDate]   = useState("");
  const [mStart, setMStart] = useState("");
  const [mEnd, setMEnd]     = useState("");
  const [mVenue, setMVenue] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setMTeamA(""); setMTeamB(""); setMDate(""); setMStart(""); setMEnd(""); setMVenue("");
    setShowForm(false);
  };

  const saveMatch = async () => {
    if (!mTeamA || !mTeamB) return Alert.alert("Pick teams", "Select both Team A and Team B.");
    if (mTeamA === mTeamB)   return Alert.alert("Same team", "Team A and Team B must be different.");
    if (mDate && !DATE_RE.test(mDate)) return Alert.alert("Date", "Use the format YYYY-MM-DD.");

    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) { setSaving(false); return Alert.alert("Session expired", "Please log in again."); }

      const res = await fetch(`${SERVER_URL}/add-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          leagueId, teamAId: mTeamA, teamBId: mTeamB,
          date: mDate.trim(), startTime: mStart.trim(),
          endTime: mEnd.trim(), venue: mVenue.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to add match.");
      resetForm();
      // matches list updates automatically via the parent's live listener
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong.");
    } finally { setSaving(false); }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={s.headRow}>
        <Text style={s.sectionTitle}>Matches ({matches.length})</Text>
        {!showForm && (
          <TouchableOpacity
            style={s.addBtn}
            onPress={() => {
              if (teams.length < 2) {
                Alert.alert("Add teams first", "You need at least 2 teams to schedule a match.");
                return;
              }
              setShowForm(true);
            }}
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={s.addBtnTxt}>Add Match</Text>
          </TouchableOpacity>
        )}
      </View>

      {showForm && (
        <View style={s.formCard}>
          <Text style={s.formTitle}>New match</Text>

          <Text style={s.label}>Team A</Text>
          <View style={s.chips}>
            {teams.map((t) => {
              const active = mTeamA === t.id; const disabled = mTeamB === t.id;
              return (
                <TouchableOpacity key={t.id} disabled={disabled}
                  style={[s.chip, active && s.chipActive, disabled && { opacity: 0.35 }]}
                  onPress={() => setMTeamA(t.id)}>
                  <Text style={[s.chipTxt, active && s.chipTxtActive]}>{t.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={s.label}>Team B</Text>
          <View style={s.chips}>
            {teams.map((t) => {
              const active = mTeamB === t.id; const disabled = mTeamA === t.id;
              return (
                <TouchableOpacity key={t.id} disabled={disabled}
                  style={[s.chip, active && s.chipActive, disabled && { opacity: 0.35 }]}
                  onPress={() => setMTeamB(t.id)}>
                  <Text style={[s.chipTxt, active && s.chipTxtActive]}>{t.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={s.label}>Date</Text>
          <TextInput style={s.input} value={mDate} onChangeText={setMDate} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />

          <View style={s.timeRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Start time</Text>
              <TextInput style={s.input} value={mStart} onChangeText={setMStart} placeholder="6:00 PM" placeholderTextColor="#9CA3AF" />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.label}>End time</Text>
              <TextInput style={s.input} value={mEnd} onChangeText={setMEnd} placeholder="8:00 PM" placeholderTextColor="#9CA3AF" />
            </View>
          </View>

          <Text style={s.label}>Venue (optional)</Text>
          <TextInput style={s.input} value={mVenue} onChangeText={setMVenue} placeholder="e.g. Ground 1" placeholderTextColor="#9CA3AF" />

          <View style={s.formActions}>
            <TouchableOpacity style={s.cancelBtn} onPress={resetForm} disabled={saving}>
              <Text style={s.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={saveMatch} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveTxt}>Save Match</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {matches.length === 0 && !showForm ? (
        <View style={s.empty}>
          <Ionicons name="calendar-outline" size={28} color={PRIMARY} />
          <Text style={s.emptyTitle}>No matches scheduled</Text>
          <Text style={s.emptySub}>Add fixtures between your teams.</Text>
        </View>
      ) : (
        matches.map((m) => {
          const cfg = MATCH_STATUS_CFG[m.status] || MATCH_STATUS_CFG.scheduled;
          return (
            <View key={m.id} style={s.matchCard}>
              <View style={s.matchTeams}>
                <Text style={s.matchTeam} numberOfLines={1}>{m.teamAName}</Text>
                <Text style={s.vs}>vs</Text>
                <Text style={[s.matchTeam, { textAlign: "right" }]} numberOfLines={1}>{m.teamBName}</Text>
              </View>
              <View style={s.matchMetaRow}>
                <Ionicons name="calendar-outline" size={13} color={MUTED} />
                <Text style={s.matchMeta}>{m.date || "TBD"}</Text>
                {!!(m.startTime || m.endTime) && (
                  <>
                    <Ionicons name="time-outline" size={13} color={MUTED} style={{ marginLeft: 10 }} />
                    <Text style={s.matchMeta}>{[m.startTime, m.endTime].filter(Boolean).join(" – ")}</Text>
                  </>
                )}
                {!!m.venue && (
                  <>
                    <Ionicons name="location-outline" size={13} color={MUTED} style={{ marginLeft: 10 }} />
                    <Text style={s.matchMeta} numberOfLines={1}>{m.venue}</Text>
                  </>
                )}
              </View>
              <View style={s.matchFooter}>
                <View style={{ flex: 1 }}>
                  <View style={[s.matchStatus, { backgroundColor: cfg.bg }]}>
                    <Text style={[s.matchStatusTxt, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                  {!!m.liveSummary && <Text style={s.liveSummary} numberOfLines={1}>{m.liveSummary}</Text>}
                </View>
                <TouchableOpacity
                  style={s.scoreBtn}
                  onPress={() => router.push(`/(playon-pro)/score/${m.id}`)}
                >
                  <Ionicons name="stats-chart-outline" size={15} color="#fff" />
                  <Text style={s.scoreBtnTxt}>{m.status === "completed" ? "View" : m.status === "live" ? "Resume" : "Score"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: DARK },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: PRIMARY, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  addBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },

  formCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, borderColor: BORDER, borderWidth: 1 },
  formTitle: { fontSize: 15, fontWeight: "800", color: DARK, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginTop: 16, marginBottom: 4 },
  input: {
    borderColor: "#E5E7EB", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#fff",
  },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderColor: "#E5E7EB", borderWidth: 1, backgroundColor: "#fff" },
  chipActive: { backgroundColor: PRIMARY_BG, borderColor: PRIMARY },
  chipTxt: { fontSize: 13, color: "#374151", fontWeight: "600" },
  chipTxtActive: { color: PRIMARY },

  timeRow: { flexDirection: "row" },

  formActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt: { color: "#374151", fontWeight: "700", fontSize: 14 },
  saveBtn: { flex: 2, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 10, backgroundColor: PRIMARY },
  saveTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },

  empty: { alignItems: "center", paddingVertical: 36, paddingHorizontal: 30, backgroundColor: "#fff", borderRadius: 16, borderColor: BORDER, borderWidth: 1, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#111827", textAlign: "center" },
  emptySub: { fontSize: 13, color: MUTED, textAlign: "center", lineHeight: 19 },

  matchCard: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, borderColor: BORDER, borderWidth: 1 },
  matchTeams: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  matchTeam: { fontSize: 15, fontWeight: "700", color: "#111827", flex: 1 },
  vs: { fontSize: 12, fontWeight: "700", color: MUTED, marginHorizontal: 10 },
  matchMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 10, flexWrap: "wrap" },
  matchMeta: { fontSize: 12, color: MUTED, marginLeft: 4 },
  matchStatus: { alignSelf: "flex-start", marginTop: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  matchStatusTxt: { fontSize: 11, fontWeight: "700" },
  matchFooter: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  liveSummary: { fontSize: 12, color: "#111827", fontWeight: "600", marginTop: 6 },
  scoreBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: PRIMARY, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  scoreBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
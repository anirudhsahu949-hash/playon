import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Keyboard, ScrollView,
} from "react-native";
import { useRef, useState } from "react";
import { db, auth } from "../../firebaseConfig";
import { collection, query, where, getDocs, limit } from "firebase/firestore";
import { getIdToken } from "firebase/auth";
import { Ionicons } from "@expo/vector-icons";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const SEARCH_LIMIT = 6;

const PRIMARY    = "#5B4FE5";
const PRIMARY_BG = "#F0EEFF";
const DARK       = "#1B2050";
const MUTED      = "#8A8FA8";
const BORDER     = "#EEF0F7";
const BG         = "#F7F8FC";

type PlayerSuggestion = { uid: string; displayName: string; playonId: string; sport: string };
type PlayerEntry = {
  searchText: string; uid: string; displayName: string; playonId: string;
  linked: boolean; suggestions: PlayerSuggestion[]; searching: boolean; showDrop: boolean;
};
const blankPlayer = (): PlayerEntry => ({
  searchText: "", uid: "", displayName: "", playonId: "",
  linked: false, suggestions: [], searching: false, showDrop: false,
});

async function getAuthToken(): Promise<string | null> {
  try {
    const u = auth.currentUser;
    return u ? await getIdToken(u) : null;
  } catch { return null; }
}

function initials(name: string) {
  return (name || "?").trim().split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

async function prefixQuery(field: string, term: string): Promise<any[]> {
  if (!term) return [];
  const end = term.slice(0, -1) + String.fromCharCode(term.charCodeAt(term.length - 1) + 1);
  const snap = await getDocs(
    query(collection(db, "playerProfiles"), where(field, ">=", term), where(field, "<", end), limit(SEARCH_LIMIT))
  );
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

async function searchProfiles(raw: string): Promise<PlayerSuggestion[]> {
  const term = raw.trim().toLowerCase().replace(/^@/, "");
  if (term.length < 2) return [];
  const [byName, byId] = await Promise.all([
    prefixQuery("displayNameLower", term),
    prefixQuery("playonId", term),
  ]);
  const seen = new Set<string>();
  const merged: PlayerSuggestion[] = [];
  for (const p of [...byName, ...byId]) {
    if (seen.has(p.uid)) continue;
    seen.add(p.uid);
    merged.push({
      uid: p.uid, displayName: p.displayName || p.playonId || "Unknown",
      playonId: p.playonId || "", sport: Array.isArray(p.sports) ? p.sports[0] : (p.sport || ""),
    });
    if (merged.length >= SEARCH_LIMIT) break;
  }
  return merged;
}

export default function LeagueTeams({ leagueId, teams }: { leagueId: string; league: any; teams: any[] }) {
  const [showForm, setShowForm]       = useState(false);
  const [teamName, setTeamName]       = useState("");
  const [captainName, setCaptainName] = useState("");
  const [players, setPlayers]         = useState<PlayerEntry[]>([blankPlayer()]);
  const [saving, setSaving]           = useState(false);

  const debounceRefs = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const updatePlayer = (i: number, patch: Partial<PlayerEntry>) =>
    setPlayers((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const onPlayerSearchChange = (i: number, text: string) => {
    if (players[i].linked && text.length === 0) {
      updatePlayer(i, blankPlayer());
      return;
    }
    updatePlayer(i, { searchText: text, linked: false, uid: "", displayName: "", playonId: "", showDrop: true });

    if (debounceRefs.current[i]) clearTimeout(debounceRefs.current[i]);

    if (text.trim().length < 2) {
      updatePlayer(i, { suggestions: [], searching: false, showDrop: false });
      return;
    }

    updatePlayer(i, { searching: true });
    debounceRefs.current[i] = setTimeout(async () => {
      try {
        const results = await searchProfiles(text);
        const alreadyLinked = new Set(players.filter((p, idx) => idx !== i && p.uid).map((p) => p.uid));
        const filtered = results.filter((r) => !alreadyLinked.has(r.uid));
        updatePlayer(i, { suggestions: filtered, searching: false, showDrop: true });
      } catch (e) {
        console.error("player search error", e);
        updatePlayer(i, { searching: false });
      }
    }, 400);
  };

  const selectSuggestion = (i: number, sg: PlayerSuggestion) => {
    if (debounceRefs.current[i]) clearTimeout(debounceRefs.current[i]);
    Keyboard.dismiss();
    updatePlayer(i, {
      searchText: sg.displayName, uid: sg.uid, displayName: sg.displayName, playonId: sg.playonId,
      linked: true, suggestions: [], searching: false, showDrop: false,
    });
  };

  const unlinkPlayer = (i: number) => {
    if (debounceRefs.current[i]) clearTimeout(debounceRefs.current[i]);
    updatePlayer(i, blankPlayer());
  };

  const addPlayerRow = () => setPlayers((prev) => [...prev, blankPlayer()]);

  const removePlayerRow = (i: number) => {
    if (debounceRefs.current[i]) clearTimeout(debounceRefs.current[i]);
    setPlayers((prev) => (prev.length === 1 ? [blankPlayer()] : prev.filter((_, idx) => idx !== i)));
  };

  const closeAllDropdowns = () => setPlayers((prev) => prev.map((p) => ({ ...p, showDrop: false })));

  const resetForm = () => {
    Object.values(debounceRefs.current).forEach(clearTimeout);
    debounceRefs.current = {};
    setTeamName(""); setCaptainName(""); setPlayers([blankPlayer()]); setShowForm(false);
  };

  const saveTeam = async () => {
    if (!teamName.trim()) return Alert.alert("Team name", "Enter the team name.");
    closeAllDropdowns();
    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) { setSaving(false); return Alert.alert("Session expired", "Please log in again."); }

      const cleanPlayers = players
        .filter((p) => (p.linked ? p.displayName : p.searchText).trim())
        .map((p) => ({
          name: p.linked ? p.displayName : p.searchText.trim(),
          ...(p.uid ? { uid: p.uid } : {}),
          ...(p.playonId ? { playonId: p.playonId } : {}),
        }));

      const res = await fetch(`${SERVER_URL}/add-team`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ leagueId, name: teamName.trim(), captainName: captainName.trim(), players: cleanPlayers }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to add team.");
      resetForm();
      // teams list updates automatically via the parent's live listener
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong.");
    } finally { setSaving(false); }
  };

  const linkedCount = players.filter((p) => p.linked).length;
  const totalFilled = players.filter((p) => (p.linked ? p.displayName : p.searchText).trim()).length;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: BG }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      onScrollBeginDrag={closeAllDropdowns}
    >
      <View style={s.headRow}>
        <Text style={s.sectionTitle}>Teams ({teams.length})</Text>
        {!showForm && (
          <TouchableOpacity style={s.addBtn} onPress={() => setShowForm(true)}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={s.addBtnTxt}>Add Team</Text>
          </TouchableOpacity>
        )}
      </View>

      {showForm && (
        <View style={s.formCard}>
          <Text style={s.formTitle}>New team</Text>

          <TextInput style={s.input} value={teamName} onChangeText={setTeamName} placeholder="Team name *" placeholderTextColor="#9CA3AF" />
          <TextInput style={[s.input, { marginTop: 10 }]} value={captainName} onChangeText={setCaptainName} placeholder="Captain name (optional)" placeholderTextColor="#9CA3AF" />

          <Text style={s.playersLabel}>Players</Text>
          <Text style={s.playersHint}>
            Type a name to search Playon profiles and link automatically — or just type a name without linking.
          </Text>

          {players.map((p, i) => (
            <PlayerRow
              key={i}
              index={i}
              player={p}
              onChangeText={(text) => onPlayerSearchChange(i, text)}
              onSelectSuggestion={(sg) => selectSuggestion(i, sg)}
              onUnlink={() => unlinkPlayer(i)}
              onRemove={() => removePlayerRow(i)}
            />
          ))}

          <TouchableOpacity style={s.addPlayer} onPress={addPlayerRow}>
            <Ionicons name="add-circle-outline" size={18} color={PRIMARY} />
            <Text style={s.addPlayerTxt}>Add player</Text>
          </TouchableOpacity>

          {totalFilled > 0 && (
            <View style={s.linkSummary}>
              <Ionicons
                name={linkedCount > 0 ? "shield-checkmark-outline" : "information-circle-outline"}
                size={14}
                color={linkedCount > 0 ? PRIMARY : MUTED}
              />
              <Text style={[s.linkSummaryTxt, { color: linkedCount > 0 ? PRIMARY : MUTED }]}>
                {linkedCount}/{totalFilled} linked to a Playon ID
                {linkedCount === 0 ? " — stats won't auto-update after matches" : " — stats update automatically after matches"}
              </Text>
            </View>
          )}

          <View style={s.formActions}>
            <TouchableOpacity style={s.cancelBtn} onPress={resetForm} disabled={saving}>
              <Text style={s.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={saveTeam} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveTxt}>Save Team</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {teams.length === 0 && !showForm ? (
        <View style={s.empty}>
          <Ionicons name="people-outline" size={28} color={PRIMARY} />
          <Text style={s.emptyTitle}>No teams yet</Text>
          <Text style={s.emptySub}>Add the teams that play in this league.</Text>
        </View>
      ) : (
        teams.map((t) => {
          const linked = (t.players || []).filter((p: any) => p.uid).length;
          return (
            <View key={t.id} style={s.teamCard}>
              <View style={s.teamAvatar}>
                <Text style={s.teamAvatarTxt}>{(t.name || "?").slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.teamName}>{t.name}</Text>
                <Text style={s.teamMeta}>
                  {t.captainName ? `Captain: ${t.captainName} · ` : ""}
                  {t.playerCount} player{t.playerCount === 1 ? "" : "s"}
                </Text>
                {t.playerCount > 0 && (
                  <View style={s.teamLinkRow}>
                    <Ionicons
                      name={linked === t.playerCount ? "shield-checkmark" : "shield-outline"}
                      size={12}
                      color={linked === t.playerCount ? PRIMARY : MUTED}
                    />
                    <Text style={[s.teamLinkTxt, { color: linked === t.playerCount ? PRIMARY : MUTED }]}>
                      {linked}/{t.playerCount} linked
                    </Text>
                  </View>
                )}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function PlayerRow({
  index, player, onChangeText, onSelectSuggestion, onUnlink, onRemove,
}: {
  index: number; player: PlayerEntry;
  onChangeText: (text: string) => void;
  onSelectSuggestion: (s: PlayerSuggestion) => void;
  onUnlink: () => void; onRemove: () => void;
}) {
  if (player.linked) {
    return (
      <View style={s.playerBlock}>
        <View style={s.linkedRow}>
          <View style={s.linkedAvatar}><Text style={s.linkedAvatarTxt}>{initials(player.displayName)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.linkedName}>{player.displayName}</Text>
            {!!player.playonId && <Text style={s.linkedId}>@{player.playonId}</Text>}
          </View>
          <View style={s.linkedCheck}><Ionicons name="shield-checkmark" size={14} color={PRIMARY} /></View>
          <TouchableOpacity onPress={onUnlink} hitSlop={8} style={s.unlinkBtn}>
            <Ionicons name="close-circle" size={20} color="#9CA3AF" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={s.playerBlock}>
      <View style={s.playerSearchRow}>
        <View style={s.searchInputWrap}>
          <Ionicons name="search-outline" size={16} color="#9CA3AF" style={{ marginLeft: 10 }} />
          <TextInput
            style={s.searchInput}
            value={player.searchText}
            onChangeText={onChangeText}
            placeholder={`Player ${index + 1} — search by name or @id`}
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {player.searching && <ActivityIndicator size="small" color="#9CA3AF" style={{ marginRight: 10 }} />}
        </View>
        <TouchableOpacity onPress={onRemove} hitSlop={8} style={s.removeBtn}>
          <Ionicons name="close" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      {player.showDrop && player.suggestions.length > 0 && (
        <View style={s.dropdown}>
          {player.suggestions.map((sg, si) => (
            <TouchableOpacity
              key={sg.uid}
              style={[s.dropItem, si < player.suggestions.length - 1 && s.dropItemBorder]}
              onPress={() => onSelectSuggestion(sg)}
              activeOpacity={0.7}
            >
              <View style={s.dropAvatar}><Text style={s.dropAvatarTxt}>{initials(sg.displayName)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.dropName}>{sg.displayName}</Text>
                <Text style={s.dropSub}>
                  {sg.playonId ? `@${sg.playonId}` : ""}{sg.playonId && sg.sport ? " · " : ""}{sg.sport || ""}
                </Text>
              </View>
              <Ionicons name="add-circle-outline" size={20} color={PRIMARY} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {player.showDrop && !player.searching && player.searchText.trim().length >= 2 && player.suggestions.length === 0 && (
        <View style={s.dropEmpty}>
          <Text style={s.dropEmptyTxt}>No Playon profiles found — player will be added without linking</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: DARK },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: PRIMARY, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  addBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },

  formCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, borderColor: BORDER, borderWidth: 1 },
  formTitle: { fontSize: 15, fontWeight: "800", color: DARK, marginBottom: 12 },
  input: {
    borderColor: "#E5E7EB", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#fff",
  },

  playersLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginTop: 16, marginBottom: 4 },
  playersHint: { fontSize: 12, color: MUTED, marginBottom: 10, lineHeight: 17 },

  playerBlock: { marginBottom: 10 },
  playerSearchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchInputWrap: { flex: 1, flexDirection: "row", alignItems: "center", borderColor: "#E5E7EB", borderWidth: 1, borderRadius: 10, backgroundColor: "#fff" },
  searchInput: { flex: 1, fontSize: 14, color: "#111827", paddingVertical: 12, paddingHorizontal: 8 },
  removeBtn: { padding: 6 },

  dropdown: {
    backgroundColor: "#fff", borderRadius: 10, borderColor: "#E5E7EB", borderWidth: 1, marginTop: 4, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 4,
  },
  dropItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
  dropItemBorder: { borderBottomColor: "#F3F4F6", borderBottomWidth: 1 },
  dropAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: DARK, alignItems: "center", justifyContent: "center" },
  dropAvatarTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  dropName: { fontSize: 14, fontWeight: "700", color: "#111827" },
  dropSub: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  dropEmpty: { backgroundColor: "#F9FAFB", borderRadius: 10, borderColor: "#E5E7EB", borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, marginTop: 4 },
  dropEmptyTxt: { fontSize: 12, color: "#9CA3AF" },

  linkedRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: PRIMARY_BG, borderColor: "#D9D4FB", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  linkedAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: PRIMARY, alignItems: "center", justifyContent: "center" },
  linkedAvatarTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  linkedName: { fontSize: 14, fontWeight: "700", color: "#111827" },
  linkedId: { fontSize: 12, color: PRIMARY, marginTop: 1 },
  linkedCheck: { padding: 2 },
  unlinkBtn: { padding: 4 },

  addPlayer: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  addPlayerTxt: { color: PRIMARY, fontWeight: "600", fontSize: 13 },

  linkSummary: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8, padding: 10, backgroundColor: BG, borderRadius: 8 },
  linkSummaryTxt: { fontSize: 12, flex: 1, lineHeight: 17 },

  formActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt: { color: "#374151", fontWeight: "700", fontSize: 14 },
  saveBtn: { flex: 2, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 10, backgroundColor: PRIMARY },
  saveTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },

  teamCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 10, borderColor: BORDER, borderWidth: 1 },
  teamAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: PRIMARY, alignItems: "center", justifyContent: "center" },
  teamAvatarTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  teamName: { fontSize: 15, fontWeight: "700", color: "#111827" },
  teamMeta: { fontSize: 12, color: MUTED, marginTop: 2 },
  teamLinkRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  teamLinkTxt: { fontSize: 11, fontWeight: "600" },

  empty: { alignItems: "center", paddingVertical: 36, paddingHorizontal: 30, backgroundColor: "#fff", borderRadius: 16, borderColor: BORDER, borderWidth: 1, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#111827", textAlign: "center" },
  emptySub: { fontSize: 13, color: MUTED, textAlign: "center", lineHeight: 19 },
});
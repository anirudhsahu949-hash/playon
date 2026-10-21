import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const PRIMARY    = "#5B4FE5";
const PRIMARY_BG = "#F0EEFF";
const DARK       = "#1B2050";
const MUTED      = "#8A8FA8";
const GREEN      = "#16A34A";
const BORDER     = "#EEF0F7";
const BG         = "#F7F8FC";

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  registration_open: { label: "UPCOMING",  color: "#2563EB", bg: "#EFF6FF" },
  ongoing:           { label: "LIVE",      color: GREEN,     bg: "#F0FDF4" },
  completed:         { label: "COMPLETED", color: MUTED,     bg: "#F3F4F6" },
};

export default function LeagueOverview({ league, teams, matches }: { league: any; teams: any[]; matches: any[] }) {
  const st = STATUS_CFG[league.status] || STATUS_CFG.registration_open;
  const liveCount     = matches.filter((m) => m.status === "live").length;
  const upcomingCount = matches.filter((m) => m.status === "scheduled").length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={s.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={s.crest}><Ionicons name="trophy" size={20} color={PRIMARY} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{league.name}</Text>
            {!!league.season && <Text style={s.season}>{league.season}</Text>}
          </View>
          <View style={[s.statusPill, { backgroundColor: st.bg }]}>
            <Text style={[s.statusTxt, { color: st.color }]}>{st.label}</Text>
          </View>
        </View>
        <Text style={s.metaLine}>{league.sport}{league.city ? ` · ${league.city}` : ""}</Text>
      </View>

      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statVal}>{teams.length}{league.maxTeams ? `/${league.maxTeams}` : ""}</Text>
          <Text style={s.statLbl}>Teams</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statVal}>{matches.length}</Text>
          <Text style={s.statLbl}>Matches</Text>
        </View>
        <View style={s.statCard}>
          <Text style={[s.statVal, { color: GREEN }]}>{liveCount}</Text>
          <Text style={s.statLbl}>Live now</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statVal}>{upcomingCount}</Text>
          <Text style={s.statLbl}>Upcoming</Text>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>League details</Text>
        <InfoRow icon="location-outline" label="City" value={league.city || "—"} />
        {!!league.venue && <InfoRow icon="navigate-outline" label="Venue" value={league.venue} />}
        <InfoRow icon="calendar-outline" label="Start date" value={league.startDate || "TBD"} />
        {!!league.endDate && <InfoRow icon="calendar-outline" label="End date" value={league.endDate} />}
        {league.hostType === "open" && (
          <>
            {!!league.registrationDeadline && (
              <InfoRow icon="hourglass-outline" label="Reg. deadline" value={league.registrationDeadline} />
            )}
            <InfoRow icon="cash-outline" label="Entry fee" value={`₹${league.entryFee || 0} per team`} />
            {league.prizePoolPercent > 0 && (
              <InfoRow icon="trophy-outline" label="Prize pool" value={`${league.prizePoolPercent}% of fees`} />
            )}
          </>
        )}
      </View>

      {!!league.description && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Description</Text>
          <Text style={s.descTxt}>{league.description}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Ionicons name={icon} size={17} color={MUTED} />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card:  { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 14 },
  crest: { width: 44, height: 44, borderRadius: 12, backgroundColor: PRIMARY_BG, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "800", color: DARK },
  season:{ fontSize: 12, color: MUTED, marginTop: 1 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7 },
  statusTxt:  { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.3 },
  metaLine:   { fontSize: 12.5, color: MUTED, marginTop: 12 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 12, alignItems: "center" },
  statVal:  { fontSize: 18, fontWeight: "900", color: DARK },
  statLbl:  { fontSize: 10, color: MUTED, marginTop: 3, textAlign: "center" },
  cardTitle: { fontSize: 14.5, fontWeight: "800", color: DARK, marginBottom: 10 },
  infoRow:   { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  infoLabel: { fontSize: 13, color: MUTED, marginLeft: 10, width: 100 },
  infoValue: { fontSize: 13.5, fontWeight: "600", color: DARK, flex: 1, textAlign: "right" },
  descTxt: { fontSize: 13, color: "#374151", lineHeight: 20 },
});
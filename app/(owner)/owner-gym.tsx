import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  StatusBar,
  RefreshControl,
  Alert,
  Switch,
  Platform,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  updateDoc,
} from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// ── Tokens ──────────────────────────────────────────────────────────────────
const DARK = "#081120";
const GYM  = "#7C3AED";

const DAY = 24 * 60 * 60 * 1000;

// ── Helpers ─────────────────────────────────────────────────────────────────
function toDate(v: any): Date {
  if (!v) return new Date(NaN);
  if (typeof v.toDate === "function") return v.toDate();
  return new Date(v);
}

function fmtDate(v: any): string {
  const d = toDate(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type MemberStatus = "active" | "expiring" | "expired";
function memberStatus(m: any): MemberStatus {
  const end = toDate(m.endDate).getTime();
  const now = Date.now();
  if (isNaN(end)) return "active";
  if (end < now) return "expired";
  if (end - now <= 7 * DAY) return "expiring";
  return "active";
}

const STATUS_META: Record<MemberStatus, { label: string; bg: string; color: string }> = {
  active:   { label: "Active",   bg: "#DCFCE7", color: "#16A34A" },
  expiring: { label: "Expiring", bg: "#FEF3C7", color: "#D97706" },
  expired:  { label: "Expired",  bg: "#FEE2E2", color: "#DC2626" },
};

// ── Screen ──────────────────────────────────────────────────────────────────
export default function OwnerGyms() {
  const router = useRouter();

  const [gyms, setGyms]               = useState<any[]>([]);
  const [memberships, setMemberships] = useState<any[]>([]);
  const [userMap, setUserMap]         = useState<Record<string, any>>({});
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }

    try {
      const [gymSnap, memSnap] = await Promise.all([
        getDocs(query(collection(db, "gyms"),        where("ownerId", "==", uid))),
        getDocs(query(collection(db, "memberships"), where("ownerId", "==", uid))),
      ]);

      const gymList = gymSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const memList = memSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setGyms(gymList);
      setMemberships(memList);

      // fetch member names (userId → user doc)
      const uids = [...new Set(memList.map((m: any) => m.userId).filter(Boolean))];
      const map: Record<string, any> = {};
      await Promise.all(
        uids.map(async (id) => {
          try {
            const us = await getDoc(doc(db, "users", id as string));
            if (us.exists()) map[id as string] = us.data();
          } catch {}
        })
      );
      setUserMap(map);
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let active = 0, expiring = 0, revenue = 0;
    for (const m of memberships) {
      revenue += Number(m.amount || 0);
      const st = memberStatus(m);
      if (st === "active") active++;
      if (st === "expiring") { active++; expiring++; } // expiring is still active
    }
    return { active, expiring, revenue };
  }, [memberships]);

  // group memberships by gym, newest first
  const byGym = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const m of memberships) {
      (map[m.gymId] ||= []).push(m);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => toDate(b.startDate).getTime() - toDate(a.startDate).getTime());
    }
    return map;
  }, [memberships]);

  const toggleActive = async (gym: any) => {
    const next = gym.active === false; // currently paused → activate, else pause
    setGyms((prev) => prev.map((g) => (g.id === gym.id ? { ...g, active: next } : g)));
    try {
      await updateDoc(doc(db, "gyms", gym.id), { active: next });
    } catch (e) {
      // revert on failure
      setGyms((prev) => prev.map((g) => (g.id === gym.id ? { ...g, active: gym.active } : g)));
      Alert.alert(
        "Couldn't update",
        "Make sure your Firestore rules allow an owner to edit their own gym."
      );
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <ActivityIndicator size="large" color={GYM} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Gyms</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GYM} />}
      >
        {/* Summary strip */}
        <View style={s.summary}>
          <View style={s.sumItem}>
            <Text style={s.sumValue}>{stats.active}</Text>
            <Text style={s.sumLabel}>Active members</Text>
          </View>
          <View style={s.sumDivider} />
          <View style={s.sumItem}>
            <Text style={s.sumValue}>₹{stats.revenue.toLocaleString("en-IN")}</Text>
            <Text style={s.sumLabel}>Revenue</Text>
          </View>
          <View style={s.sumDivider} />
          <View style={s.sumItem}>
            <Text style={[s.sumValue, stats.expiring > 0 && { color: "#D97706" }]}>{stats.expiring}</Text>
            <Text style={s.sumLabel}>Expiring ≤7d</Text>
          </View>
        </View>

        {gyms.length === 0 ? (
          <View style={s.emptyBox}>
            <Ionicons name="barbell-outline" size={34} color="#9CA3AF" />
            <Text style={s.emptyTitle}>No gyms yet</Text>
            <Text style={s.emptySub}>Ask the admin to add a gym under your account.</Text>
          </View>
        ) : (
          gyms.map((gym) => {
            const members = byGym[gym.id] || [];
            const gymRevenue = members.reduce((sum, m) => sum + Number(m.amount || 0), 0);
            const activeCount = members.filter((m) => memberStatus(m) !== "expired").length;
            const isActive = gym.active !== false;

            return (
              <View key={gym.id} style={s.gymCard}>
                {/* gym header */}
                <View style={s.gymTop}>
                  <View style={s.gymIcon}>
                    <Ionicons name="barbell" size={20} color={GYM} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.gymName} numberOfLines={1}>{gym.name}</Text>
                    <Text style={s.gymLoc} numberOfLines={1}>{gym.location || "—"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Switch
                      value={isActive}
                      onValueChange={() => toggleActive(gym)}
                      trackColor={{ true: GYM, false: "#D1D5DB" }}
                      thumbColor="#fff"
                    />
                    <Text style={[s.toggleLabel, { color: isActive ? "#16A34A" : "#9CA3AF" }]}>
                      {isActive ? "Live" : "Paused"}
                    </Text>
                  </View>
                </View>

                {/* gym mini stats */}
                <View style={s.gymStats}>
                  <View style={s.gymStat}>
                    <Text style={s.gymStatValue}>{activeCount}</Text>
                    <Text style={s.gymStatLabel}>Members</Text>
                  </View>
                  <View style={s.gymStat}>
                    <Text style={s.gymStatValue}>₹{gymRevenue.toLocaleString("en-IN")}</Text>
                    <Text style={s.gymStatLabel}>Revenue</Text>
                  </View>
                  <View style={s.gymStat}>
                    <Text style={s.gymStatValue}>{Array.isArray(gym.plans) ? gym.plans.length : 0}</Text>
                    <Text style={s.gymStatLabel}>Plans</Text>
                  </View>
                </View>

                {/* members */}
                <Text style={s.membersTitle}>Members ({members.length})</Text>
                {members.length === 0 ? (
                  <Text style={s.noMembers}>No memberships sold yet.</Text>
                ) : (
                  members.map((m) => {
                    const st = memberStatus(m);
                    const meta = STATUS_META[st];
                    const u = userMap[m.userId] || {};
                    const name = u.name || "Member";
                    return (
                      <View key={m.id} style={s.memberRow}>
                        <View style={s.memberAvatar}>
                          <Text style={s.memberAvatarTxt}>{name.charAt(0).toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.memberName} numberOfLines={1}>{name}</Text>
                          <Text style={s.memberMeta} numberOfLines={1}>
                            {m.planLabel} · expires {fmtDate(m.endDate)}
                          </Text>
                        </View>
                        <View style={[s.statusChip, { backgroundColor: meta.bg }]}>
                          <Text style={[s.statusChipTxt, { color: meta.color }]}>{meta.label}</Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F0F4F8" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F0F4F8" },

  header: {
    backgroundColor: DARK,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 14,
    paddingBottom: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  backBtn:     { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", justifyContent: "center", alignItems: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },

  summary: {
    flexDirection: "row", backgroundColor: "#fff", borderRadius: 20, padding: 16,
    borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 16,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2, alignItems: "center",
  },
  sumItem:    { flex: 1, alignItems: "center", gap: 2 },
  sumValue:   { fontSize: 18, fontWeight: "900", color: "#0F172A" },
  sumLabel:   { fontSize: 11, color: "#9CA3AF", fontWeight: "600" },
  sumDivider: { width: 1, height: 34, backgroundColor: "#F3F4F6" },

  emptyBox:   { backgroundColor: "#fff", borderRadius: 20, padding: 32, alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB", gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#0F172A", marginTop: 4 },
  emptySub:   { fontSize: 13, color: "#9CA3AF", textAlign: "center" },

  gymCard: { backgroundColor: "#fff", borderRadius: 20, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  gymTop:  { flexDirection: "row", alignItems: "center", gap: 12 },
  gymIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#F3F0FF", justifyContent: "center", alignItems: "center" },
  gymName: { fontSize: 16, fontWeight: "900", color: "#0F172A" },
  gymLoc:  { fontSize: 12, color: "#9CA3AF", marginTop: 2, fontWeight: "500" },
  toggleLabel: { fontSize: 10, fontWeight: "800", marginTop: 2 },

  gymStats: { flexDirection: "row", backgroundColor: "#F9FAFB", borderRadius: 14, paddingVertical: 12, marginTop: 14, borderWidth: 1, borderColor: "#F1F2F4" },
  gymStat:  { flex: 1, alignItems: "center", gap: 2 },
  gymStatValue: { fontSize: 15, fontWeight: "900", color: "#0F172A" },
  gymStatLabel: { fontSize: 10, color: "#9CA3AF", fontWeight: "600" },

  membersTitle: { fontSize: 13, fontWeight: "800", color: "#374151", marginTop: 18, marginBottom: 10 },
  noMembers:    { fontSize: 13, color: "#9CA3AF", fontWeight: "500", paddingVertical: 6 },

  memberRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  memberAvatar:    { width: 38, height: 38, borderRadius: 19, backgroundColor: "#F3F0FF", justifyContent: "center", alignItems: "center" },
  memberAvatarTxt: { fontSize: 15, fontWeight: "900", color: GYM },
  memberName:      { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  memberMeta:      { fontSize: 12, color: "#9CA3AF", marginTop: 2, fontWeight: "500" },
  statusChip:      { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  statusChipTxt:   { fontSize: 10, fontWeight: "800" },
});
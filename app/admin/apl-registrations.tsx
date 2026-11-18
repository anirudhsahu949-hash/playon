/**
 * app/admin/apl-registrations.tsx — every player who registered, live.
 *
 * Shows the money, the pool, and who still needs a refund.
 * Tap any row → app/admin/apl-player/[id].tsx for the full details.
 *
 * Reads aplRegistrations where leagueId == <leagueId>. No server call needed
 * for the list itself — Firestore streams it.
 */
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Image,
  ActivityIndicator, StatusBar, Share, Alert,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../../firebaseConfig";
import { cldThumb } from "../../utils/cloudinary";

const GREEN   = "#16A34A";
const GREEN_D = "#15803D";
const DARK    = "#0B1220";
const BG      = "#F3F4F6";
const BORDER  = "#E5E7EB";
const MUTED   = "#6B7280";

type Tab = "all" | "pool" | "sold" | "unsold" | "refunded" | "unpaid";

const TAB_LABEL: Record<Tab, string> = {
  all: "All", pool: "In pool", sold: "Sold", unsold: "Unsold", refunded: "Refunded", unpaid: "Not paid",
};

function statusPill(r: any) {
  const refund = r.refundStatus || "none";
  if (r.paymentStatus !== "paid")                          return { txt: "NOT PAID",    fg: "#B91C1C", bg: "#FEF2F2", bd: "#FECACA" };
  if (refund === "processed")                              return { txt: "REFUNDED",    fg: "#374151", bg: "#F3F4F6", bd: BORDER };
  if (refund === "initiated" || refund === "processing")   return { txt: "REFUNDING",   fg: "#1D4ED8", bg: "#EFF6FF", bd: "#BFDBFE" };
  if (refund === "failed")                                 return { txt: "REFUND FAILED", fg: "#B91C1C", bg: "#FEF2F2", bd: "#FECACA" };
  if (r.status === "sold")                                 return { txt: "SOLD",        fg: "#1D4ED8", bg: "#EFF6FF", bd: "#BFDBFE" };
  if (r.status === "unsold")                               return { txt: "REFUND DUE",  fg: "#B45309", bg: "#FFFBEB", bd: "#FDE68A" };
  return { txt: "IN POOL", fg: GREEN_D, bg: "#F0FDF4", bd: "#BBF7D0" };
}

function initials(name: string) {
  return String(name || "?").trim().split(/\s+/).map((w) => w[0] || "").join("").toUpperCase().slice(0, 2);
}

export default function AplRegistrations() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ leagueId?: string }>();
  const leagueId = (params.leagueId as string) || "apl-2026";

  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<Tab>("all");
  const [q, setQ]             = useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "aplRegistrations"), where("leagueId", "==", leagueId)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        list.sort((a, b) => Number(b.serial || 0) - Number(a.serial || 0));
        setRows(list);
        setLoading(false);
      },
      (e) => { console.log("apl list error", e); setLoading(false); },
    );
    return unsub;
  }, [leagueId]);

  const stats = useMemo(() => {
    const paid      = rows.filter((r) => r.paymentStatus === "paid");
    const collected = paid.reduce((sum, r) => sum + Number(r.fee || 0), 0);
    const refunded  = paid.filter((r) => ["processed", "initiated", "processing"].includes(r.refundStatus || "none"));
    const refundDue = paid.filter((r) => r.status === "unsold" && (r.refundStatus || "none") === "none").length;
    return {
      count: paid.length,
      collected: collected - refunded.reduce((sum, r) => sum + Number(r.refundAmount || r.fee || 0), 0),
      refundDue,
    };
  }, [rows]);

  const counts = useMemo(() => {
    const paid = rows.filter((r) => r.paymentStatus === "paid");
    return {
      all:      rows.length,
      pool:     paid.filter((r) => r.status === "pool").length,
      sold:     paid.filter((r) => r.status === "sold").length,
      unsold:   paid.filter((r) => r.status === "unsold" && (r.refundStatus || "none") === "none").length,
      refunded: paid.filter((r) => ["processed", "initiated", "processing"].includes(r.refundStatus || "none")).length,
      unpaid:   rows.filter((r) => r.paymentStatus !== "paid").length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "pool"     && !(r.paymentStatus === "paid" && r.status === "pool")) return false;
      if (tab === "sold"     && r.status !== "sold") return false;
      if (tab === "unsold"   && !(r.status === "unsold" && (r.refundStatus || "none") === "none")) return false;
      if (tab === "refunded" && !["processed", "initiated", "processing"].includes(r.refundStatus || "none")) return false;
      if (tab === "unpaid"   && r.paymentStatus === "paid") return false;
      if (!needle) return true;
      return (
        String(r.name || "").toLowerCase().includes(needle) ||
        String(r.mobile || "").includes(needle) ||
        String(r.regNo || "").toLowerCase().includes(needle) ||
        String(r.area || "").toLowerCase().includes(needle)
      );
    });
  }, [rows, tab, q]);

  const exportCsv = async () => {
    try {
      const head = "RegNo,Name,Mobile,Age,Area,Role,Batting,Bowling,Jersey,Paid,Status,Team,SoldPrice,RefundStatus,PaymentId";
      const body = rows.map((r) => [
        r.regNo || "", r.name || "", r.mobile || "", r.age || "", r.area || "",
        r.role || "", r.battingHand || "", r.bowlingStyle || "",
        `${r.jerseySize || ""} ${r.jerseyNo || ""}`.trim(),
        r.amountPaid || 0, r.status || "", r.teamName || "", r.soldPrice || "",
        r.refundStatus || "none", r.paymentId || "",
      ].map((v) => `"${String(v).replace(/"/g, "'")}"`).join(",")).join("\n");

      await Share.share({ message: `${head}\n${body}`, title: "APL registrations" });
    } catch {
      Alert.alert("Could not share", "Please try again.");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={s.hBtn}>
          <Ionicons name="chevron-back" size={20} color="#E5E7EB" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>APL Registrations</Text>
          <Text style={s.hSub}>{leagueId} · live</Text>
        </View>
        <TouchableOpacity onPress={exportCsv} style={s.csvBtn} activeOpacity={0.85}>
          <Ionicons name="download-outline" size={15} color="#E5E7EB" />
          <Text style={s.csvTxt}>CSV</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={GREEN} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 12 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* stats */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Stat value={String(stats.count)} label="Registered" />
            <Stat value={`₹${stats.collected.toLocaleString("en-IN")}`} label="Collected" color={GREEN_D} />
            <Stat value={String(stats.refundDue)} label="Refunds due" color={stats.refundDue ? "#B45309" : "#111827"} />
          </View>

          {/* search */}
          <View style={s.searchWrap}>
            <Ionicons name="search" size={17} color="#9CA3AF" />
            <TextInput
              style={s.search}
              value={q}
              onChangeText={setQ}
              placeholder="Search name, mobile or APL ID"
              placeholderTextColor="#9CA3AF"
            />
            {!!q && (
              <TouchableOpacity onPress={() => setQ("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>

          {/* tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
            <View style={{ flexDirection: "row", gap: 7 }}>
              {(Object.keys(TAB_LABEL) as Tab[]).map((t) => {
                const on = tab === t;
                return (
                  <TouchableOpacity key={t} onPress={() => setTab(t)} activeOpacity={0.85}
                    style={[s.chip, on && { backgroundColor: DARK, borderColor: DARK }]}>
                    <Text style={[s.chipTxt, on && { color: "#FFFFFF", fontWeight: "700" }]}>
                      {TAB_LABEL[t]} {counts[t]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* list */}
          <View style={{ gap: 8, marginTop: 12 }}>
            {shown.length === 0 ? (
              <View style={s.empty}>
                <Ionicons name="people-outline" size={34} color="#9CA3AF" />
                <Text style={s.emptyTxt}>{q ? "No player matches that search." : "No players here yet."}</Text>
              </View>
            ) : shown.map((r) => {
              const p = statusPill(r);
              return (
                <TouchableOpacity
                  key={r.id}
                  activeOpacity={0.85}
                  onPress={() => router.push({ pathname: "/admin/apl-player/[id]", params: { id: r.id } } as any)}
                  style={[s.row, { borderColor: p.bd }]}
                >
                  {r.photoUrl
                    ? <Image source={{ uri: cldThumb(r.photoUrl, 120) }} style={s.avatarImg} />
                    : <View style={s.avatar}><Text style={s.avatarTxt}>{initials(r.name)}</Text></View>}

                  <View style={{ flex: 1 }}>
                    <Text style={s.rowName} numberOfLines={1}>{r.name || "—"}</Text>
                    <Text style={s.rowSub} numberOfLines={1}>
                      {[r.regNo, r.role, r.area].filter(Boolean).join(" · ")}
                    </Text>
                    {r.status === "sold" && !!r.teamName && (
                      <Text style={s.rowTeam} numberOfLines={1}>{r.teamName}{r.soldPrice ? ` · ₹${r.soldPrice}` : ""}</Text>
                    )}
                  </View>

                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <View style={[s.pill, { backgroundColor: p.bg, borderColor: p.bd }]}>
                      <Text style={[s.pillTxt, { color: p.fg }]}>{p.txt}</Text>
                    </View>
                    <Text style={s.rowAmt}>₹{r.paymentStatus === "paid" ? (r.fee ?? 0) : 0}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {shown.length > 0 && (
            <Text style={s.foot}>Showing {shown.length} of {rows.length}</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, color ? { color } : null]} numberOfLines={1}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: { backgroundColor: DARK, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  hBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: "#263349", backgroundColor: "#141E31", alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 15.5, fontWeight: "700", color: "#FFFFFF" },
  hSub: { fontSize: 11.5, color: "#9CA3AF", marginTop: 2 },
  csvBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1, borderColor: "#263349", backgroundColor: "#141E31" },
  csvTxt: { color: "#E5E7EB", fontSize: 12, fontWeight: "700" },

  stat: { flex: 1, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 10 },
  statValue: { fontSize: 19, fontWeight: "800", color: "#111827" },
  statLabel: { fontSize: 11, color: MUTED, fontWeight: "600", marginTop: 3 },

  searchWrap: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 13, height: 46, marginTop: 12 },
  search: { flex: 1, fontSize: 13.5, color: "#111827" },

  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5, borderColor: BORDER, backgroundColor: "#FFFFFF" },
  chipTxt: { fontSize: 12, fontWeight: "600", color: "#374151" },

  row: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#FFFFFF", borderWidth: 1, borderRadius: 12, padding: 12 },
  avatar: { width: 40, height: 40, borderRadius: 999, backgroundColor: DARK, alignItems: "center", justifyContent: "center" },
  avatarImg: { width: 40, height: 40, borderRadius: 999, backgroundColor: "#E5E7EB" },
  avatarTxt: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  rowName: { fontSize: 13.5, fontWeight: "700", color: "#111827" },
  rowSub: { fontSize: 11.5, color: MUTED, marginTop: 3 },
  rowTeam: { fontSize: 11.5, color: "#1D4ED8", fontWeight: "700", marginTop: 3 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt: { fontSize: 10.5, fontWeight: "700" },
  rowAmt: { fontSize: 11.5, fontWeight: "700", color: "#374151" },

  empty: { alignItems: "center", gap: 10, paddingVertical: 40, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 14 },
  emptyTxt: { fontSize: 13, color: MUTED },
  foot: { fontSize: 11.5, color: MUTED, textAlign: "center", marginTop: 14 },
});

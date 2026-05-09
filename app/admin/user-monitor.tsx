import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, StatusBar,
  Platform, Modal, Linking, Dimensions, Animated,
} from "react-native";
import Svg, {
  Path, Circle, G, Line, Text as ST, Defs,
  LinearGradient as SvgLG, Stop, Rect,
} from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  collection, getDocs, doc, updateDoc, deleteDoc,
  query, where, serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";
import AdminNavBar from "./adminavabar";

// ─── Theme ────────────────────────────────────────────────────────────────────
const DARK   = "#0F1923";
const ACCENT = "#0EA5A4";
const BG     = "#F0F4F8";
const { width: SW } = Dimensions.get("window");

// ─── Types ────────────────────────────────────────────────────────────────────
type UserStatus = "active" | "blocked" | "deactivated";
type SortKey    = "name" | "createdAt" | "totalBookings" | "totalSpent";
type FilterStatus = "all" | UserStatus;

interface AppUser {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  favoriteSport?: string;
  photo?: string;
  role?: string;
  status?: UserStatus;
  createdAt?: any;
  totalBookings?: number;
  totalSpent?: number;
  lastBookingDate?: any;
  cancelledBookings?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return n >= 100000 ? `₹${(n/100000).toFixed(1)}L`
       : n >= 1000   ? `₹${(n/1000).toFixed(1)}K`
       : `₹${n}`;
}
function fmtDate(ts: any): string {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function timeAgo(ts: any): string {
  if (!ts) return "Never";
  const d = ts instanceof Date ? ts : ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)      return "just now";
  if (diff < 3600)    return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)   return `${Math.floor(diff/3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff/86400)}d ago`;
  return fmtDate(ts);
}
function initials(name?: string) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}
function avatarColor(id: string) {
  const colors = ["#6366F1","#0EA5A4","#F59E0B","#EF4444","#8B5CF6","#EC4899","#14B8A6","#F97316"];
  let h = 0; for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const STATUS_META: Record<UserStatus, { label: string; color: string; bg: string; icon: any }> = {
  active:      { label: "Active",      color: "#059669", bg: "#D1FAE5", icon: "checkmark-circle"  },
  blocked:     { label: "Blocked",     color: "#DC2626", bg: "#FEE2E2", icon: "ban"               },
  deactivated: { label: "Deactivated", color: "#6B7280", bg: "#F3F4F6", icon: "pause-circle"      },
};

// ─── Monthly growth chart ─────────────────────────────────────────────────────
function MonthlyChart({ users }: { users: AppUser[] }) {
  const W = SW - 48;
  const H = 140;
  const PL = 32; const PR = 16; const PT = 16; const PB = 28;
  const iW = W - PL - PR;
  const iH = H - PT - PB;

  // Build last 6 months
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { month: d.getMonth(), year: d.getFullYear(), label: MONTHS[d.getMonth()] };
  });

  const counts = months.map(m =>
    users.filter(u => {
      if (!u.createdAt) return false;
      const d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
      return d.getMonth() === m.month && d.getFullYear() === m.year;
    }).length
  );

  const maxV = Math.max(...counts, 1);

  const pts = counts.map((v, i) => ({
    x: PL + (i / (months.length - 1)) * iW,
    y: PT + (1 - v / maxV) * iH,
    label: months[i].label,
    value: v,
  }));

  const pathD = pts.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = pts[i - 1];
    const cx = (prev.x + pt.x) / 2;
    return `${acc} C ${cx} ${prev.y} ${cx} ${pt.y} ${pt.x} ${pt.y}`;
  }, "");

  const fillD = `${pathD} L ${pts[pts.length-1].x} ${PT+iH} L ${pts[0].x} ${PT+iH} Z`;

  // Peak month
  const peakIdx = counts.indexOf(Math.max(...counts));

  return (
    <View>
      <Svg width={W} height={H}>
        <Defs>
          <SvgLG id="ug" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={ACCENT} stopOpacity="0.28" />
            <Stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </SvgLG>
        </Defs>
        {/* Grid lines */}
        {[0, Math.round(maxV / 2), maxV].map((val, i) => {
          const y = PT + (1 - val / maxV) * iH;
          return (
            <G key={i}>
              <Line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#E5E7EB" strokeWidth="1" strokeDasharray="3 3" />
              <ST x={PL - 4} y={y + 4} fontSize="9" fill="#9CA3AF" textAnchor="end">{val}</ST>
            </G>
          );
        })}
        {/* Fill + line */}
        <Path d={fillD} fill="url(#ug)" />
        <Path d={pathD} stroke={ACCENT} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots + labels */}
        {pts.map((pt, i) => (
          <G key={i}>
            {i === peakIdx && (
              <Circle cx={pt.x} cy={pt.y} r="12" fill={ACCENT} opacity="0.12" />
            )}
            <Circle cx={pt.x} cy={pt.y} r="4" fill="#FFFFFF" stroke={ACCENT} strokeWidth="2" />
            {pt.value > 0 && (
              <ST x={pt.x} y={pt.y - 10} fontSize="10" fill={ACCENT} textAnchor="middle" fontWeight="700">
                {pt.value}
              </ST>
            )}
            <ST x={pt.x} y={H - 4} fontSize="9" fill="#9CA3AF" textAnchor="middle">{pt.label}</ST>
          </G>
        ))}
      </Svg>
      {/* Peak callout */}
      {counts[peakIdx] > 0 && (
        <View style={ch.peakRow}>
          <Ionicons name="trending-up" size={13} color={ACCENT} />
          <Text style={ch.peakTxt}>
            Best month: <Text style={{ color: ACCENT, fontWeight: "700" }}>{months[peakIdx].label}</Text> with {counts[peakIdx]} new user{counts[peakIdx] !== 1 ? "s" : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

const ch = StyleSheet.create({
  peakRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, paddingHorizontal: 4 },
  peakTxt: { fontSize: 12, color: "#6B7280" },
});

// ─── Mini bar chart for sport breakdown ───────────────────────────────────────
function SportBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? value / max : 0;
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
        <Text style={{ fontSize: 12, color: "#374151", fontWeight: "600" }}>{label}</Text>
        <Text style={{ fontSize: 12, color: "#9CA3AF" }}>{value}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: "#F3F4F6", borderRadius: 3 }}>
        <View style={{ height: 6, width: `${pct * 100}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

// ─── Filter panel (collapsible) ───────────────────────────────────────────────
function FilterPanel({
  visible, filterStatus, setFilterStatus,
  sortKey, setSortKey,
  onReset,
}: {
  visible: boolean;
  filterStatus: FilterStatus; setFilterStatus: (v: FilterStatus) => void;
  sortKey: SortKey; setSortKey: (v: SortKey) => void;
  onReset: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [visible]);

  const maxH = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 260] });
  const opacity = anim;

  return (
    <Animated.View style={[fp.wrap, { maxHeight: maxH, opacity }]}>
      <View style={fp.inner}>
        {/* Status */}
        <Text style={fp.groupLabel}>Status</Text>
        <View style={fp.chipRow}>
          {(["all","active","blocked","deactivated"] as const).map(st => (
            <TouchableOpacity
              key={st}
              style={[fp.chip, filterStatus === st && fp.chipOnTeal]}
              onPress={() => setFilterStatus(st)}
            >
              <Text style={[fp.chipTxt, filterStatus === st && fp.chipTxtOn]}>
                {st === "all" ? "All" : STATUS_META[st].label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Sort */}
        <Text style={fp.groupLabel}>Sort by</Text>
        <View style={fp.chipRow}>
          {([
            { key: "createdAt",     label: "Newest first"    },
            { key: "totalBookings", label: "Most bookings"   },
            { key: "totalSpent",    label: "Highest spend"   },
            { key: "name",          label: "Name A–Z"        },
          ] as { key: SortKey; label: string }[]).map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[fp.chip, sortKey === opt.key && fp.chipOnIndigo]}
              onPress={() => setSortKey(opt.key)}
            >
              <Text style={[fp.chipTxt, sortKey === opt.key && fp.chipTxtOn]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={fp.resetBtn} onPress={onReset}>
          <Ionicons name="refresh-outline" size={13} color="#6B7280" />
          <Text style={fp.resetTxt}>Reset all filters</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const fp = StyleSheet.create({
  wrap:        { overflow: "hidden", backgroundColor: "#F8FAFC" },
  inner:       { padding: 16, paddingTop: 8 },
  groupLabel:  { fontSize: 11, fontWeight: "700", color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 8 },
  chipRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  chipOnTeal:  { backgroundColor: ACCENT, borderColor: ACCENT },
  chipOnIndigo:{ backgroundColor: "#6366F1", borderColor: "#6366F1" },
  chipTxt:     { fontSize: 13, fontWeight: "600", color: "#374151" },
  chipTxtOn:   { color: "#FFFFFF" },
  resetBtn:    { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 14, alignSelf: "flex-start", paddingVertical: 4 },
  resetTxt:    { fontSize: 13, color: "#6B7280" },
});

// ─── User card ────────────────────────────────────────────────────────────────
function UserCard({ user, onPress }: { user: AppUser; onPress: () => void }) {
  const status = user.status || "active";
  const sm     = STATUS_META[status];
  const color  = avatarColor(user.id);

  return (
    <TouchableOpacity style={uc.card} onPress={onPress} activeOpacity={0.82}>
      {status === "blocked"     && <View style={[uc.stripe, { backgroundColor: "#DC2626" }]} />}
      {status === "deactivated" && <View style={[uc.stripe, { backgroundColor: "#9CA3AF" }]} />}

      {/* Top row */}
      <View style={uc.top}>
        <View style={[uc.avatar, { backgroundColor: color }]}>
          <Text style={uc.avatarTxt}>{initials(user.name)}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={uc.nameRow}>
            <Text style={uc.name} numberOfLines={1}>{user.name || "Unknown"}</Text>
            <View style={[uc.pill, { backgroundColor: sm.bg }]}>
              <Text style={[uc.pillTxt, { color: sm.color }]}>{sm.label}</Text>
            </View>
          </View>
          <Text style={uc.meta} numberOfLines={1}>{user.email || "—"}</Text>
          <Text style={uc.meta}>{user.phone || "No phone"}</Text>
        </View>
      </View>

      {/* Stats row */}
      <View style={uc.statsRow}>
        <View style={uc.stat}>
          <Text style={[uc.statNum, { color: "#6366F1" }]}>{user.totalBookings ?? 0}</Text>
          <Text style={uc.statLbl}>Bookings</Text>
        </View>
        <View style={uc.statDiv} />
        <View style={uc.stat}>
          <Text style={[uc.statNum, { color: "#059669" }]}>{fmt(user.totalSpent ?? 0)}</Text>
          <Text style={uc.statLbl}>Spent</Text>
        </View>
        <View style={uc.statDiv} />
        <View style={uc.stat}>
          <Text style={[uc.statNum, { color: "#DC2626" }]}>{user.cancelledBookings ?? 0}</Text>
          <Text style={uc.statLbl}>Cancelled</Text>
        </View>
        <View style={uc.statDiv} />
        <View style={uc.stat}>
          <Text style={[uc.statNum, { color: "#D97706", fontSize: 11 }]} numberOfLines={1}>
            {timeAgo(user.lastBookingDate)}
          </Text>
          <Text style={uc.statLbl}>Last booked</Text>
        </View>
      </View>

      {/* Footer chips */}
      <View style={uc.footer}>
        {user.location ? (
          <View style={uc.chip}><Ionicons name="location-outline" size={10} color="#9CA3AF" /><Text style={uc.chipTxt}>{user.location}</Text></View>
        ) : null}
        {user.favoriteSport ? (
          <View style={uc.chip}><Ionicons name="football-outline" size={10} color="#9CA3AF" /><Text style={uc.chipTxt}>{user.favoriteSport}</Text></View>
        ) : null}
        <Text style={uc.joined}>Joined {fmtDate(user.createdAt)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const uc = StyleSheet.create({
  card:      { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, marginBottom: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2, overflow: "hidden" },
  stripe:    { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 },
  top:       { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  avatar:    { width: 48, height: 48, borderRadius: 24, justifyContent: "center", alignItems: "center" },
  avatarTxt: { fontSize: 17, fontWeight: "800", color: "#FFFFFF" },
  nameRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
  name:      { fontSize: 15, fontWeight: "700", color: "#111827", flex: 1 },
  pill:      { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  pillTxt:   { fontSize: 10, fontWeight: "700" },
  meta:      { fontSize: 12, color: "#6B7280", marginBottom: 1 },
  statsRow:  { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, marginBottom: 12 },
  stat:      { flex: 1, alignItems: "center" },
  statNum:   { fontSize: 14, fontWeight: "800", marginBottom: 2 },
  statLbl:   { fontSize: 10, color: "#9CA3AF" },
  statDiv:   { width: 1, height: 30, backgroundColor: "#E5E7EB" },
  footer:    { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  chip:      { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipTxt:   { fontSize: 11, color: "#6B7280" },
  joined:    { fontSize: 11, color: "#D1D5DB", marginLeft: "auto" },
});

// ─── Detail modal ─────────────────────────────────────────────────────────────
function UserDetailModal({ user, visible, onClose, onUpdated, onDeleted }: {
  user: AppUser | null; visible: boolean;
  onClose: () => void;
  onUpdated: (u: AppUser) => void;
  onDeleted: (id: string) => void;
}) {
  const [updating, setUpdating]             = useState(false);
  const [bookings, setBookings]             = useState<any[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  useEffect(() => {
    if (visible && user) fetchUserBookings();
    else setBookings([]);
  }, [visible, user?.id]);

  const fetchUserBookings = async () => {
    if (!user) return;
    setLoadingBookings(true);
    try {
      const snap = await getDocs(query(collection(db, "bookings"), where("userId", "==", user.id)));
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const da = a.date?.toDate?.() ?? new Date(a.dateString ?? 0);
          const db2 = b.date?.toDate?.() ?? new Date(b.dateString ?? 0);
          return db2 - da;
        }));
    } catch { /* silent */ }
    finally { setLoadingBookings(false); }
  };

  const changeStatus = (newStatus: UserStatus) => {
    if (!user) return;
    const labels: Record<UserStatus, string> = { blocked: "Block", deactivated: "Deactivate", active: "Activate" };
    const msgs: Record<UserStatus, string> = {
      blocked: "They will be immediately signed out and cannot log back in.",
      deactivated: "Their account will be temporarily suspended.",
      active: "Their account access will be fully restored.",
    };
    Alert.alert(`${labels[newStatus]} user?`, msgs[newStatus], [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        style: newStatus === "blocked" ? "destructive" : "default",
        onPress: async () => {
          setUpdating(true);
          try {
            await updateDoc(doc(db, "users", user.id), { status: newStatus, statusUpdatedAt: serverTimestamp() });
            onUpdated({ ...user, status: newStatus });
          } catch { Alert.alert("Error", "Could not update status."); }
          finally { setUpdating(false); }
        },
      },
    ]);
  };

  const handleDelete = () => {
    if (!user) return;
    Alert.alert(
      "Delete user permanently?",
      `This will delete ${user.name || "this user"}'s account data from Firestore. Their bookings will remain. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete permanently",
          style: "destructive",
          onPress: async () => {
            setUpdating(true);
            try {
              await deleteDoc(doc(db, "users", user.id));
              onDeleted(user.id);
              onClose();
            } catch { Alert.alert("Error", "Could not delete user."); }
            finally { setUpdating(false); }
          },
        },
      ]
    );
  };

  if (!user) return null;
  const status = user.status || "active";
  const sm     = STATUS_META[status];
  const color  = avatarColor(user.id);
  const cancelRate = user.totalBookings
    ? Math.round(((user.cancelledBookings ?? 0) / user.totalBookings) * 100) : 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={dm.root}>
        <StatusBar barStyle="dark-content" />

        {/* Header */}
        <View style={dm.header}>
          <TouchableOpacity onPress={onClose} style={dm.closeBtn}>
            <Ionicons name="close" size={22} color="#374151" />
          </TouchableOpacity>
          <Text style={dm.headerTitle} numberOfLines={1}>{user.name || "User"}</Text>
          <View style={[dm.badge, { backgroundColor: sm.bg }]}>
            <Text style={[dm.badgeTxt, { color: sm.color }]}>{sm.label}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={dm.scroll} showsVerticalScrollIndicator={false}>

          {/* Profile */}
          <View style={dm.card}>
            <View style={[dm.bigAvatar, { backgroundColor: color }]}>
              <Text style={dm.bigAvatarTxt}>{initials(user.name)}</Text>
            </View>
            <Text style={dm.profileName}>{user.name || "Unknown"}</Text>
            {user.email        && <Text style={dm.profileSub}>{user.email}</Text>}
            {user.phone        && <Text style={dm.profileSub}>{user.phone}</Text>}
            {user.location     && <Text style={dm.profileSub}>{user.location}</Text>}
            {user.favoriteSport && (
              <View style={dm.sportPill}>
                <Ionicons name="football-outline" size={12} color="#6366F1" />
                <Text style={dm.sportTxt}>{user.favoriteSport}</Text>
              </View>
            )}
            <Text style={dm.joined}>Joined {fmtDate(user.createdAt)}</Text>
          </View>

          {/* Contact buttons */}
          <View style={dm.contactRow}>
            {user.email && (
              <TouchableOpacity style={dm.contactBtn} onPress={() => Linking.openURL(`mailto:${user.email}`)}>
                <Ionicons name="mail-outline" size={18} color="#2563EB" />
                <Text style={[dm.contactLbl, { color: "#2563EB" }]}>Email</Text>
              </TouchableOpacity>
            )}
            {user.phone && (
              <>
                <TouchableOpacity style={dm.contactBtn} onPress={() => Linking.openURL(`tel:${user.phone}`)}>
                  <Ionicons name="call-outline" size={18} color="#059669" />
                  <Text style={[dm.contactLbl, { color: "#059669" }]}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity style={dm.contactBtn} onPress={() => {
                  const clean = (user.phone || "").replace(/\D/g, "");
                  Linking.openURL(`https://wa.me/91${clean}?text=Hi ${user.name || "there"}, this is Playon support.`);
                }}>
                  <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                  <Text style={[dm.contactLbl, { color: "#25D366" }]}>WhatsApp</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Stats grid */}
          <View style={dm.card}>
            <Text style={dm.sectionLbl}>Booking stats</Text>
            <View style={dm.statsGrid}>
              {[
                { label: "Total bookings", value: String(user.totalBookings ?? 0), color: "#6366F1" },
                { label: "Total spent",    value: fmt(user.totalSpent ?? 0),        color: "#059669" },
                { label: "Cancelled",      value: String(user.cancelledBookings??0),color: "#DC2626" },
                { label: "Cancel rate",    value: `${cancelRate}%`,                 color: "#D97706" },
              ].map((s, i) => (
                <View key={i} style={dm.statBox}>
                  <Text style={[dm.statVal, { color: s.color }]}>{s.value}</Text>
                  <Text style={dm.statLbl2}>{s.label}</Text>
                </View>
              ))}
            </View>
            {user.lastBookingDate && (
              <Text style={dm.lastBook}>Last booking: {fmtDate(user.lastBookingDate)}</Text>
            )}
          </View>

          {/* Account control */}
          <View style={dm.card}>
            <Text style={dm.sectionLbl}>Account control</Text>

            {status !== "active" && (
              <TouchableOpacity style={[dm.actionBtn, { backgroundColor: "#F0FDF4", borderColor: "#D1FAE5" }]}
                onPress={() => changeStatus("active")} disabled={updating}>
                <Ionicons name="checkmark-circle-outline" size={18} color="#059669" />
                <Text style={[dm.actionTxt, { color: "#059669" }]}>Activate account</Text>
              </TouchableOpacity>
            )}
            {status !== "deactivated" && (
              <TouchableOpacity style={[dm.actionBtn, { backgroundColor: "#F9FAFB", borderColor: "#E5E7EB" }]}
                onPress={() => changeStatus("deactivated")} disabled={updating}>
                <Ionicons name="pause-circle-outline" size={18} color="#6B7280" />
                <Text style={[dm.actionTxt, { color: "#6B7280" }]}>Deactivate account</Text>
              </TouchableOpacity>
            )}
            {status !== "blocked" && (
              <TouchableOpacity style={[dm.actionBtn, { backgroundColor: "#FFF5F5", borderColor: "#FEE2E2" }]}
                onPress={() => changeStatus("blocked")} disabled={updating}>
                <Ionicons name="ban-outline" size={18} color="#DC2626" />
                <Text style={[dm.actionTxt, { color: "#DC2626" }]}>Block user</Text>
              </TouchableOpacity>
            )}
            {updating && <ActivityIndicator size="small" color={ACCENT} style={{ marginTop: 8 }} />}
          </View>

          {/* Booking history */}
          <View style={dm.card}>
            <Text style={dm.sectionLbl}>Booking history</Text>
            {loadingBookings ? (
              <ActivityIndicator size="small" color={ACCENT} />
            ) : bookings.length === 0 ? (
              <Text style={dm.noHistory}>No bookings yet.</Text>
            ) : (
              bookings.slice(0, 12).map((b: any) => {
                const total  = Number(b.totalAmount ?? b.paidAmount ?? b.price ?? 0);
                const bst    = b.status || "pending";
                const bColor = bst === "confirmed" ? "#059669" : bst === "cancelled" ? "#DC2626" : "#6B7280";
                const slots  = Array.isArray(b.selectedSlots) && b.selectedSlots.length
                  ? b.selectedSlots[0] + (b.selectedSlots.length > 1 ? ` +${b.selectedSlots.length - 1}` : "")
                  : b.slotTime || "—";
                const dateStr = b.date?.toDate?.()
                  ? b.date.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                  : b.dateString ?? "—";
                return (
                  <View key={b.id} style={dm.histRow}>
                    <View style={[dm.histDot, { backgroundColor: bColor }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={dm.histTurf} numberOfLines={1}>{b.turfName || "Turf"}</Text>
                      <Text style={dm.histMeta}>{dateStr}  ·  {slots}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={dm.histAmt}>{total > 0 ? fmt(total) : "—"}</Text>
                      <Text style={[dm.histSt, { color: bColor }]}>{bst.toUpperCase()}</Text>
                    </View>
                  </View>
                );
              })
            )}
            {bookings.length > 12 && (
              <Text style={dm.more}>+{bookings.length - 12} more bookings</Text>
            )}
          </View>

          {/* Danger zone */}
          <View style={[dm.card, { borderWidth: 1, borderColor: "#FEE2E2" }]}>
            <Text style={[dm.sectionLbl, { color: "#DC2626" }]}>Danger zone</Text>
            <Text style={dm.dangerNote}>
              Deleting removes this user's Firestore document permanently. Their past bookings are kept for records.
            </Text>
            <TouchableOpacity style={dm.deleteBtn} onPress={handleDelete} disabled={updating}>
              <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
              <Text style={dm.deleteBtnTxt}>Delete user permanently</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const dm = StyleSheet.create({
  root:       { flex: 1, backgroundColor: "#F9FAFB" },
  header:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#F3F4F6", backgroundColor: "#FFFFFF", gap: 10 },
  closeBtn:   { padding: 4 },
  headerTitle:{ flex: 1, fontSize: 16, fontWeight: "700", color: "#111827" },
  badge:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeTxt:   { fontSize: 11, fontWeight: "700" },
  scroll:     { paddingHorizontal: 16, paddingTop: 16 },
  card:       { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  bigAvatar:  { width: 72, height: 72, borderRadius: 36, justifyContent: "center", alignItems: "center", alignSelf: "center", marginBottom: 12 },
  bigAvatarTxt:{ fontSize: 26, fontWeight: "800", color: "#FFFFFF" },
  profileName:{ fontSize: 20, fontWeight: "800", color: "#111827", textAlign: "center", marginBottom: 4 },
  profileSub: { fontSize: 13, color: "#6B7280", textAlign: "center", marginBottom: 2 },
  sportPill:  { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#EEF2FF", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, alignSelf: "center", marginTop: 8 },
  sportTxt:   { fontSize: 12, fontWeight: "600", color: "#6366F1" },
  joined:     { fontSize: 12, color: "#9CA3AF", textAlign: "center", marginTop: 8 },
  sectionLbl: { fontSize: 11, fontWeight: "700", color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  contactRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  contactBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24, borderWidth: 1, borderColor: "#E5E7EB", flex: 1, justifyContent: "center" },
  contactLbl: { fontSize: 13, fontWeight: "600" },
  statsGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statBox:    { flex: 1, minWidth: "45%", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12 },
  statVal:    { fontSize: 20, fontWeight: "800", marginBottom: 2 },
  statLbl2:   { fontSize: 11, color: "#9CA3AF" },
  lastBook:   { fontSize: 12, color: "#9CA3AF", marginTop: 10 },
  actionBtn:  { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  actionTxt:  { fontSize: 14, fontWeight: "600" },
  histRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  histDot:    { width: 8, height: 8, borderRadius: 4 },
  histTurf:   { fontSize: 13, fontWeight: "600", color: "#111827", marginBottom: 2 },
  histMeta:   { fontSize: 11, color: "#9CA3AF" },
  histAmt:    { fontSize: 13, fontWeight: "700", color: "#111827" },
  histSt:     { fontSize: 10, fontWeight: "700", marginTop: 2 },
  noHistory:  { fontSize: 13, color: "#9CA3AF", textAlign: "center", paddingVertical: 20 },
  more:       { fontSize: 12, color: "#9CA3AF", textAlign: "center", marginTop: 8 },
  dangerNote: { fontSize: 13, color: "#6B7280", marginBottom: 14, lineHeight: 19 },
  deleteBtn:  { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#DC2626", paddingVertical: 13, paddingHorizontal: 20, borderRadius: 12, justifyContent: "center" },
  deleteBtnTxt:{ fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
});

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function AdminUsers() {
  const router = useRouter();

  const [users,        setUsers]        = useState<AppUser[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [search,       setSearch]       = useState("");
  const [sortKey,      setSortKey]      = useState<SortKey>("createdAt");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [selected,     setSelected]     = useState<AppUser | null>(null);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [filterOpen,   setFilterOpen]   = useState(false);

  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [userSnap, bookingSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "user"))),
        getDocs(collection(db, "bookings")),
      ]);

      const statsMap: Record<string, { total: number; spent: number; cancelled: number; lastDate: any }> = {};
      bookingSnap.docs.forEach(d => {
        const b = d.data();
        const uid = b.userId; if (!uid) return;
        if (!statsMap[uid]) statsMap[uid] = { total: 0, spent: 0, cancelled: 0, lastDate: null };
        statsMap[uid].total++;
        if (b.status !== "cancelled") statsMap[uid].spent += Number(b.totalAmount ?? b.paidAmount ?? b.price ?? 0);
        if (b.status === "cancelled") statsMap[uid].cancelled++;
        const bd = b.date?.toDate?.() ?? (b.dateString ? new Date(b.dateString) : null);
        if (bd && (!statsMap[uid].lastDate || bd > statsMap[uid].lastDate)) statsMap[uid].lastDate = bd;
      });

      setUsers(userSnap.docs.map(d => {
        const stat = statsMap[d.id] || { total: 0, spent: 0, cancelled: 0, lastDate: null };
        return { id: d.id, ...d.data(), totalBookings: stat.total, totalSpent: stat.spent, cancelledBookings: stat.cancelled, lastBookingDate: stat.lastDate } as AppUser;
      }));
    } catch { Alert.alert("Error", "Could not load users."); }
    finally { setLoading(false); setRefreshing(false); }
  };

  // ── Summary ────────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const now = new Date();
    return {
      total:      users.length,
      active:     users.filter(u => (u.status || "active") === "active").length,
      blocked:    users.filter(u => u.status === "blocked").length,
      deactivated:users.filter(u => u.status === "deactivated").length,
      totalSpent: users.reduce((s, u) => s + (u.totalSpent ?? 0), 0),
      withBookings:users.filter(u => (u.totalBookings ?? 0) > 0).length,
      thisMonth:  users.filter(u => {
        if (!u.createdAt) return false;
        const d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length,
    };
  }, [users]);

  // ── Sport breakdown ────────────────────────────────────────────────────────
  const sportBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    users.forEach(u => { if (u.favoriteSport) map[u.favoriteSport] = (map[u.favoriteSport] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [users]);
  const sportColors = ["#6366F1","#0EA5A4","#F59E0B","#EF4444","#8B5CF6"];

  // ── Filter + sort ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...users];
    if (filterStatus !== "all") list = list.filter(u => (u.status || "active") === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u => [u.name, u.email, u.phone, u.location, u.favoriteSport].some(f => f?.toLowerCase().includes(q)));
    }
    list.sort((a, b) => {
      if (sortKey === "name")          return (a.name||"").localeCompare(b.name||"");
      if (sortKey === "totalBookings") return (b.totalBookings??0) - (a.totalBookings??0);
      if (sortKey === "totalSpent")    return (b.totalSpent??0) - (a.totalSpent??0);
      const da = a.createdAt?.toDate?.() ?? new Date(a.createdAt??0);
      const db2 = b.createdAt?.toDate?.() ?? new Date(b.createdAt??0);
      return db2 - da;
    });
    return list;
  }, [users, filterStatus, search, sortKey]);

  const activeFilters = (filterStatus !== "all" ? 1 : 0) + (sortKey !== "createdAt" ? 1 : 0);

  const openUser = (u: AppUser) => { setSelected(u); setModalOpen(true); };
  const onUpdated = (u: AppUser) => {
    setUsers(prev => prev.map(x => x.id === u.id ? u : x));
    setSelected(u);
  };
  const onDeleted = (id: string) => setUsers(prev => prev.filter(x => x.id !== id));

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color={ACCENT} />
      <Text style={s.loadTxt}>Loading users...</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* ── Sticky search + filter toggle only ── */}
      <View style={s.stickyBar}>
        <View style={s.searchBar}>
          <Ionicons name="search-outline" size={16} color="#9CA3AF" />
          <TextInput
            style={s.searchInput}
            placeholder="Search name, email, phone, location..."
            placeholderTextColor="#9CA3AF"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[s.filterToggle, filterOpen && s.filterToggleOn]}
          onPress={() => setFilterOpen(v => !v)}
        >
          <Ionicons name="options-outline" size={18} color={filterOpen ? "#FFFFFF" : "#374151"} />
          {activeFilters > 0 && (
            <View style={s.filterBadge}>
              <Text style={s.filterBadgeTxt}>{activeFilters}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Collapsible filter panel ── */}
      <FilterPanel
        visible={filterOpen}
        filterStatus={filterStatus} setFilterStatus={setFilterStatus}
        sortKey={sortKey} setSortKey={setSortKey}
        onReset={() => { setFilterStatus("all"); setSortKey("createdAt"); }}
      />

      {/* ── All content scrolls together ── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchUsers(true)} tintColor={ACCENT} />}
      >
        {/* Hero */}
        <View style={s.hero}>
          <View style={s.heroGlow1} /><View style={s.heroGlow2} />
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={s.heroTag}>Admin · Users</Text>
          <Text style={s.heroTitle}>User Management</Text>
          <Text style={s.heroSub}>Monitor, control, and reach every user on the platform.</Text>

          {/* Stat chips */}
          <View style={s.statRow}>
            {[
              { num: summary.total,       lbl: "Total",     color: "#FFFFFF" },
              { num: summary.active,      lbl: "Active",    color: "#4ADE80" },
              { num: summary.blocked,     lbl: "Blocked",   color: "#F87171" },
              { num: summary.thisMonth,   lbl: "This month",color: "#FBBF24" },
              { num: summary.withBookings,lbl: "Have booked",color: "#A78BFA" },
            ].map((st, i) => (
              <React.Fragment key={i}>
                {i > 0 && <View style={s.statDivider} />}
                <View style={s.statItem}>
                  <Text style={[s.statNum, { color: st.color }]}>{st.num}</Text>
                  <Text style={s.statLbl}>{st.lbl}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* Monthly growth chart */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Monthly user growth</Text>
            <View style={s.pill}>
              <Text style={s.pillTxt}>Last 6 months</Text>
            </View>
          </View>
          <MonthlyChart users={users} />
        </View>

        {/* Platform summary row */}
        <View style={s.summaryRow}>
          <View style={s.summaryCard}>
            <Text style={[s.summaryNum, { color: "#6366F1" }]}>{fmt(summary.totalSpent)}</Text>
            <Text style={s.summaryLbl}>Platform revenue</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={[s.summaryNum, { color: "#0EA5A4" }]}>
              {summary.total > 0 ? Math.round((summary.withBookings / summary.total) * 100) : 0}%
            </Text>
            <Text style={s.summaryLbl}>Booking conversion</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={[s.summaryNum, { color: "#F59E0B" }]}>
              {summary.withBookings > 0 ? fmt(Math.round(summary.totalSpent / summary.withBookings)) : "—"}
            </Text>
            <Text style={s.summaryLbl}>Avg spend / user</Text>
          </View>
        </View>

        {/* Sport breakdown */}
        {sportBreakdown.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Favourite sports</Text>
            {sportBreakdown.map(([sport, count], i) => (
              <SportBar
                key={sport}
                label={sport}
                value={count}
                max={sportBreakdown[0][1]}
                color={sportColors[i % sportColors.length]}
              />
            ))}
          </View>
        )}

        {/* User list */}
        <View style={s.listHeader}>
          <Text style={s.listCount}>{filtered.length} user{filtered.length !== 1 ? "s" : ""}</Text>
          {activeFilters > 0 && (
            <TouchableOpacity onPress={() => { setFilterStatus("all"); setSortKey("createdAt"); setSearch(""); }}>
              <Text style={s.clearAll}>Clear all</Text>
            </TouchableOpacity>
          )}
        </View>

        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="people-outline" size={52} color="#D1D5DB" />
            <Text style={s.emptyTitle}>No users found</Text>
            <Text style={s.emptySub}>{search ? "Try a different search term." : "No users match the current filters."}</Text>
          </View>
        ) : (
          filtered.map(u => <UserCard key={u.id} user={u} onPress={() => openUser(u)} />)
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      <AdminNavBar />

      <UserDetailModal
        user={selected}
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onUpdated={onUpdated}
        onDeleted={onDeleted}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: BG },
  loadWrap:{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadTxt: { marginTop: 12, color: "#9CA3AF", fontSize: 14 },

  // Sticky bar — ONLY search + filter button, no hero
  stickyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    zIndex: 10,
  },
  searchBar:   { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, gap: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  searchInput: { flex: 1, fontSize: 14, color: "#111827" },
  filterToggle:{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center" },
  filterToggleOn:{ backgroundColor: ACCENT },
  filterBadge: { position: "absolute", top: 4, right: 4, width: 14, height: 14, borderRadius: 7, backgroundColor: "#EF4444", justifyContent: "center", alignItems: "center" },
  filterBadgeTxt:{ fontSize: 8, color: "#FFFFFF", fontWeight: "800" },

  scrollContent: { paddingBottom: 20 },

  // Hero scrolls with content
  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? 20 : 16,
    paddingBottom: 24,
    overflow: "hidden",
  },
  heroGlow1: { position: "absolute", top: -40, right: -30, width: 180, height: 180, borderRadius: 90, backgroundColor: ACCENT, opacity: 0.1 },
  heroGlow2: { position: "absolute", bottom: -20, left: -20, width: 120, height: 120, borderRadius: 60, backgroundColor: "#6366F1", opacity: 0.08 },
  backBtn:   { marginBottom: 14 },
  heroTag:   { fontSize: 11, fontWeight: "700", color: ACCENT, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 },
  heroTitle: { fontSize: 28, fontWeight: "800", color: "#FFFFFF", marginBottom: 4 },
  heroSub:   { fontSize: 13, color: "#94A3B8", marginBottom: 18 },

  statRow:     { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 6 },
  statItem:    { flex: 1, alignItems: "center" },
  statNum:     { fontSize: 15, fontWeight: "800" },
  statLbl:     { fontSize: 9, color: "#64748B", marginTop: 2, textAlign: "center" },
  statDivider: { width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.1)" },

  section:      { backgroundColor: "#FFFFFF", marginHorizontal: 16, marginTop: 14, borderRadius: 16, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  sectionHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  pill:         { backgroundColor: "#F3F4F6", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  pillTxt:      { fontSize: 11, color: "#6B7280", fontWeight: "600" },

  summaryRow:  { flexDirection: "row", gap: 10, marginHorizontal: 16, marginTop: 14 },
  summaryCard: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  summaryNum:  { fontSize: 18, fontWeight: "800", marginBottom: 4 },
  summaryLbl:  { fontSize: 10, color: "#9CA3AF", textAlign: "center" },

  listHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 16, marginTop: 20, marginBottom: 10 },
  listCount:   { fontSize: 13, color: "#9CA3AF", fontWeight: "600" },
  clearAll:    { fontSize: 13, color: ACCENT, fontWeight: "700" },

  empty:       { alignItems: "center", paddingVertical: 60, paddingHorizontal: 16 },
  emptyTitle:  { fontSize: 16, fontWeight: "700", color: "#374151", marginTop: 12 },
  emptySub:    { fontSize: 13, color: "#9CA3AF", marginTop: 4, textAlign: "center" },
});
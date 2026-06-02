import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, FlatList, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, StatusBar,
  Platform, Modal, Linking, Dimensions, Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  collection, getDocs, doc, updateDoc, deleteDoc,
  query, where, serverTimestamp, limit,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";
import AdminNavBar from "./adminavabar";

const DARK    = "#0B1220";
const WHITE   = "#FFFFFF";
const GREEN   = "#4DB408";
const GREEN_LT= "#EBF9E0";
const BODY_BG = "#F5F6FA";
const GRAY1   = "#F3F4F6";
const GRAY2   = "#E5E7EB";
const GRAY3   = "#9CA3AF";
const GRAY4   = "#6B7280";
const GRAY5   = "#4B5563";
const ACCENT  = "#0EA5A4";

const { width: SW } = Dimensions.get("window");

// ─── Types ────────────────────────────────────────────────────────────────────
type UserStatus   = "active" | "blocked" | "deactivated";
type SortKey      = "createdAt" | "name" | "totalBookings" | "totalSpent";
type FilterStatus = "all" | UserStatus;

interface AppUser {
  id: string;
  name?: string; email?: string; phone?: string;
  location?: string; favoriteSport?: string; role?: string;
  status?: UserStatus; createdAt?: any;
  totalBookings?: number; totalSpent?: number;
  cancelledBookings?: number; lastBookingDate?: any;
}

// ─── Module-level booking cache ───────────────────────────────────────────────
// Persists across re-renders and tab switches — cleared only on manual refresh
let _bookingCache: any[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getBookingsFromCache(forceRefresh = false): Promise<any[]> {
  if (!forceRefresh && _bookingCache && Date.now() - _cacheTime < CACHE_TTL) {
    console.log("📦 Using booking cache — 0 reads");
    return _bookingCache;
  }
  console.log("🔥 Fetching bookings from Firestore");
  const snap = await getDocs(collection(db, "bookings"));
  _bookingCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _cacheTime = Date.now();
  return _bookingCache;
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
  if (isNaN(d.getTime())) return "Never";
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
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}
function toMidnight(d: Date): Date {
  const c = new Date(d); c.setHours(0,0,0,0); return c;
}

const STATUS_META: Record<UserStatus, { label: string; color: string; bg: string; icon: any }> = {
  active:      { label: "Active",      color: "#059669", bg: "#D1FAE5", icon: "checkmark-circle"  },
  blocked:     { label: "Blocked",     color: "#DC2626", bg: "#FEE2E2", icon: "ban"               },
  deactivated: { label: "Deactivated", color: "#6B7280", bg: GRAY1,     icon: "pause-circle"      },
};

// ─── Inline Calendar ──────────────────────────────────────────────────────────
function InlineCalendar({ selectedDate, minDate, onSelect }: {
  selectedDate: Date; minDate?: Date; onSelect: (d: Date) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(selectedDate); d.setDate(1); d.setHours(0,0,0,0); return d;
  });
  const today = toMidnight(new Date());
  const cells = useMemo(() => {
    const yr = viewMonth.getFullYear(), mo = viewMonth.getMonth();
    const first = new Date(yr, mo, 1).getDay(), total = new Date(yr, mo+1, 0).getDate();
    const arr: (Date|null)[] = [];
    for (let i = 0; i < first; i++) arr.push(null);
    for (let d = 1; d <= total; d++) arr.push(new Date(yr, mo, d));
    return arr;
  }, [viewMonth]);
  const isDisabled = (d: Date) => minDate ? toMidnight(d) < toMidnight(minDate) : false;
  const isSelected = (d: Date) => toMidnight(d).getTime() === toMidnight(selectedDate).getTime();
  const isToday    = (d: Date) => toMidnight(d).getTime() === today.getTime();
  return (
    <View style={ic.wrap}>
      <View style={ic.nav}>
        <TouchableOpacity style={ic.navBtn} onPress={() => { const d = new Date(viewMonth); d.setMonth(d.getMonth()-1); setViewMonth(d); }}>
          <Ionicons name="chevron-back" size={16} color={GRAY5} />
        </TouchableOpacity>
        <Text style={ic.month}>{viewMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</Text>
        <TouchableOpacity style={ic.navBtn} onPress={() => { const d = new Date(viewMonth); d.setMonth(d.getMonth()+1); setViewMonth(d); }}>
          <Ionicons name="chevron-forward" size={16} color={GRAY5} />
        </TouchableOpacity>
      </View>
      <View style={ic.weekRow}>
        {["S","M","T","W","T","F","S"].map((w,i) => <Text key={i} style={ic.weekDay}>{w}</Text>)}
      </View>
      <View style={ic.grid}>
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={ic.cell} />;
          const dis = isDisabled(d), sel = isSelected(d), tod = isToday(d);
          return (
            <TouchableOpacity key={i} style={[ic.cell, sel && ic.cellSel, tod && !sel && ic.cellTod]}
              onPress={() => !dis && onSelect(d)} disabled={dis} activeOpacity={0.7}>
              <Text style={[ic.dayTxt, sel && ic.dayTxtSel, tod && !sel && ic.dayTxtTod, dis && ic.dayTxtDis]}>
                {d.getDate()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Filter Sheet Modal ───────────────────────────────────────────────────────
function FilterSheet({
  visible, onClose,
  filterStatus, setFilterStatus,
  sortKey, setSortKey,
  dateFrom, dateTo, dateActive,
  setDateFrom, setDateTo, setDateActive,
  onReset,
}: {
  visible: boolean; onClose: () => void;
  filterStatus: FilterStatus; setFilterStatus: (v: FilterStatus) => void;
  sortKey: SortKey; setSortKey: (v: SortKey) => void;
  dateFrom: Date; dateTo: Date; dateActive: boolean;
  setDateFrom: (d: Date) => void; setDateTo: (d: Date) => void;
  setDateActive: (v: boolean) => void;
  onReset: () => void;
}) {
  const [showFromCal, setShowFromCal] = useState(false);
  const [showToCal,   setShowToCal]   = useState(false);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={fs.overlay}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={fs.sheet}>
          <View style={fs.handle} />

          {/* Header */}
          <View style={fs.header}>
            <Text style={fs.title}>Filters</Text>
            <TouchableOpacity style={fs.resetBtn} onPress={onReset}>
              <Ionicons name="refresh-outline" size={14} color={GRAY4} />
              <Text style={fs.resetTxt}>Reset</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Status */}
            <Text style={fs.groupLabel}>Account Status</Text>
            <View style={fs.chipRow}>
              {(["all","active","blocked","deactivated"] as const).map(st => {
                const active = filterStatus === st;
                const meta = st === "all" ? null : STATUS_META[st];
                return (
                  <TouchableOpacity
                    key={st}
                    style={[fs.chip, active && { backgroundColor: meta?.color ?? DARK, borderColor: meta?.color ?? DARK }]}
                    onPress={() => setFilterStatus(st)}
                  >
                    {meta && <Ionicons name={meta.icon} size={12} color={active ? WHITE : meta.color} />}
                    <Text style={[fs.chipTxt, active && { color: WHITE }]}>
                      {st === "all" ? "All users" : meta!.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Sort */}
            <Text style={fs.groupLabel}>Sort By</Text>
            <View style={fs.chipRow}>
              {([
                { key: "createdAt",     label: "Newest joined" },
                { key: "name",          label: "Name A–Z"      },
                { key: "totalBookings", label: "Most bookings" },
                { key: "totalSpent",    label: "Highest spend" },
              ] as { key: SortKey; label: string }[]).map(opt => {
                const active = sortKey === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[fs.chip, active && { backgroundColor: DARK, borderColor: DARK }]}
                    onPress={() => setSortKey(opt.key)}
                  >
                    <Text style={[fs.chipTxt, active && { color: WHITE }]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Joined date range */}
            <View style={fs.dateHeader}>
              <Text style={fs.groupLabel}>Joined Date Range</Text>
              {dateActive && (
                <TouchableOpacity onPress={() => { setDateActive(false); setShowFromCal(false); setShowToCal(false); }}>
                  <Text style={fs.clearDate}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={fs.datePillRow}>
              <TouchableOpacity
                style={[fs.datePill, showFromCal && fs.datePillActive]}
                onPress={() => { setShowFromCal(true); setShowToCal(false); }}
                activeOpacity={0.8}
              >
                <Ionicons name="calendar-outline" size={14} color={showFromCal ? WHITE : DARK} />
                <View>
                  <Text style={[fs.datePillLabel, showFromCal && { color: "rgba(255,255,255,0.7)" }]}>FROM</Text>
                  <Text style={[fs.datePillValue, showFromCal && { color: WHITE }]}>
                    {dateFrom.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </Text>
                </View>
              </TouchableOpacity>

              <Ionicons name="arrow-forward" size={14} color={GRAY3} />

              <TouchableOpacity
                style={[fs.datePill, showToCal && fs.datePillActive]}
                onPress={() => { setShowToCal(true); setShowFromCal(false); }}
                activeOpacity={0.8}
              >
                <Ionicons name="calendar-outline" size={14} color={showToCal ? WHITE : DARK} />
                <View>
                  <Text style={[fs.datePillLabel, showToCal && { color: "rgba(255,255,255,0.7)" }]}>TO</Text>
                  <Text style={[fs.datePillValue, showToCal && { color: WHITE }]}>
                    {dateTo.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {(showFromCal || showToCal) && (
              <InlineCalendar
                selectedDate={showFromCal ? dateFrom : dateTo}
                minDate={showToCal ? dateFrom : undefined}
                onSelect={(d) => {
                  if (showFromCal) {
                    setDateFrom(d);
                    if (d > dateTo) setDateTo(d);
                    setShowFromCal(false);
                    setShowToCal(true);
                  } else {
                    setDateTo(d);
                    setShowToCal(false);
                    setDateActive(true);
                  }
                }}
              />
            )}

            {/* Apply */}
            <TouchableOpacity
              style={fs.applyBtn}
              onPress={() => {
                if (showFromCal || showToCal) setDateActive(true);
                onClose();
              }}
            >
              <Text style={fs.applyTxt}>Apply Filters</Text>
            </TouchableOpacity>
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── User Card ────────────────────────────────────────────────────────────────
const UserCard = React.memo(function UserCard({ user, onPress }: { user: AppUser; onPress: () => void }) {
  const status = user.status || "active";
  const sm     = STATUS_META[status];
  const color  = avatarColor(user.id);
  const cancelRate = user.totalBookings
    ? Math.round(((user.cancelledBookings ?? 0) / user.totalBookings) * 100) : 0;

  return (
    <TouchableOpacity style={uc.card} onPress={onPress} activeOpacity={0.85}>
      {/* Left status bar */}
      <View style={[uc.bar, { backgroundColor: sm.color }]} />

      <View style={uc.inner}>
        {/* Top row */}
        <View style={uc.top}>
          <View style={[uc.avatar, { backgroundColor: color }]}>
            <Text style={uc.avatarTxt}>{initials(user.name)}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={uc.nameRow}>
              <Text style={uc.name} numberOfLines={1}>{user.name || "Unknown"}</Text>
              <View style={[uc.pill, { backgroundColor: sm.bg }]}>
                <Ionicons name={sm.icon} size={10} color={sm.color} />
                <Text style={[uc.pillTxt, { color: sm.color }]}>{sm.label}</Text>
              </View>
            </View>
            {!!user.email && <Text style={uc.meta} numberOfLines={1}>{user.email}</Text>}
            {!!user.phone && <Text style={uc.meta}>{user.phone}</Text>}
          </View>
        </View>

        {/* Stats row */}
        <View style={uc.statsRow}>
          {[
            { val: String(user.totalBookings ?? 0), lbl: "Bookings",  color: "#6366F1" },
            { val: fmt(user.totalSpent ?? 0),       lbl: "Spent",     color: "#059669" },
            { val: String(user.cancelledBookings ?? 0), lbl: "Cancelled", color: "#DC2626" },
            { val: `${cancelRate}%`,                lbl: "Cancel %",  color: "#D97706" },
          ].map((st, i) => (
            <React.Fragment key={i}>
              {i > 0 && <View style={uc.divider} />}
              <View style={uc.stat}>
                <Text style={[uc.statVal, { color: st.color }]}>{st.val}</Text>
                <Text style={uc.statLbl}>{st.lbl}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Footer */}
        <View style={uc.footer}>
          {!!user.location && (
            <View style={uc.chip}>
              <Ionicons name="location-outline" size={10} color={GRAY3} />
              <Text style={uc.chipTxt}>{user.location}</Text>
            </View>
          )}
          {!!user.favoriteSport && (
            <View style={uc.chip}>
              <Ionicons name="football-outline" size={10} color={GRAY3} />
              <Text style={uc.chipTxt}>{user.favoriteSport}</Text>
            </View>
          )}
          <Text style={uc.joined}>Joined {fmtDate(user.createdAt)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ─── User Detail Modal ────────────────────────────────────────────────────────
function UserDetailModal({ user, visible, onClose, onUpdated, onDeleted, allBookings }: {
  user: AppUser | null; visible: boolean;
  onClose: () => void;
  onUpdated: (u: AppUser) => void;
  onDeleted: (id: string) => void;
  allBookings: any[];   // ✅ from cache — 0 reads
}) {
  const [updating, setUpdating] = useState(false);

  // ✅ Filter from cache — 0 Firestore reads
  const userBookings = useMemo(() => {
    if (!user) return [];
    return allBookings
      .filter(b => b.userId === user.id)
      .sort((a: any, b: any) => {
        const da = a.date?.toDate?.() ?? new Date(a.dateString ?? 0);
        const db2 = b.date?.toDate?.() ?? new Date(b.dateString ?? 0);
        return db2 - da;
      });
  }, [user?.id, allBookings]);

  const changeStatus = (newStatus: UserStatus) => {
    if (!user) return;
    const msgs: Record<UserStatus, string> = {
      blocked:     "They will be signed out and cannot log back in.",
      deactivated: "Their account will be temporarily suspended.",
      active:      "Their account access will be fully restored.",
    };
    Alert.alert(`Change status to ${newStatus}?`, msgs[newStatus], [
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
      `This removes ${user.name || "this user"} from Firestore. Bookings are kept. Cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
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
          <TouchableOpacity style={dm.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={20} color={GRAY5} />
          </TouchableOpacity>
          <Text style={dm.headerTitle} numberOfLines={1}>{user.name || "User"}</Text>
          <View style={[dm.badge, { backgroundColor: sm.bg }]}>
            <Ionicons name={sm.icon} size={11} color={sm.color} />
            <Text style={[dm.badgeTxt, { color: sm.color }]}>{sm.label}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={dm.scroll} showsVerticalScrollIndicator={false}>

          {/* Profile card */}
          <View style={dm.card}>
            <View style={[dm.bigAvatar, { backgroundColor: color }]}>
              <Text style={dm.bigAvatarTxt}>{initials(user.name)}</Text>
            </View>
            <Text style={dm.profileName}>{user.name || "Unknown"}</Text>
            {!!user.email && <Text style={dm.profileSub}>{user.email}</Text>}
            {!!user.phone && <Text style={dm.profileSub}>{user.phone}</Text>}
            {!!user.location && <Text style={dm.profileSub}>{user.location}</Text>}
            {!!user.favoriteSport && (
              <View style={dm.sportPill}>
                <Ionicons name="football-outline" size={12} color="#6366F1" />
                <Text style={dm.sportTxt}>{user.favoriteSport}</Text>
              </View>
            )}
            <Text style={dm.joined}>Joined {fmtDate(user.createdAt)}</Text>
          </View>

          {/* Contact row */}
          <View style={dm.contactRow}>
            {!!user.email && (
              <TouchableOpacity style={dm.contactBtn} onPress={() => Linking.openURL(`mailto:${user.email}`)}>
                <Ionicons name="mail-outline" size={17} color="#2563EB" />
                <Text style={[dm.contactLbl, { color: "#2563EB" }]}>Email</Text>
              </TouchableOpacity>
            )}
            {!!user.phone && (
              <>
                <TouchableOpacity style={dm.contactBtn} onPress={() => Linking.openURL(`tel:${user.phone}`)}>
                  <Ionicons name="call-outline" size={17} color="#059669" />
                  <Text style={[dm.contactLbl, { color: "#059669" }]}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity style={dm.contactBtn} onPress={() => {
                  const c = (user.phone||"").replace(/\D/g,"");
                  Linking.openURL(`https://wa.me/91${c}?text=Hi ${user.name||"there"}, this is Playon support.`);
                }}>
                  <Ionicons name="logo-whatsapp" size={17} color="#25D366" />
                  <Text style={[dm.contactLbl, { color: "#25D366" }]}>WhatsApp</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Stats */}
          <View style={dm.card}>
            <Text style={dm.sectionLbl}>Booking Stats</Text>
            <View style={dm.statsGrid}>
              {[
                { label: "Total bookings", value: String(user.totalBookings ?? 0),     color: "#6366F1" },
                { label: "Total spent",    value: fmt(user.totalSpent ?? 0),            color: "#059669" },
                { label: "Cancelled",      value: String(user.cancelledBookings ?? 0),  color: "#DC2626" },
                { label: "Cancel rate",    value: `${cancelRate}%`,                     color: "#D97706" },
              ].map((s,i) => (
                <View key={i} style={dm.statBox}>
                  <Text style={[dm.statVal, { color: s.color }]}>{s.value}</Text>
                  <Text style={dm.statLbl2}>{s.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Account control */}
          <View style={dm.card}>
            <Text style={dm.sectionLbl}>Account Control</Text>
            {status !== "active" && (
              <TouchableOpacity style={[dm.actionBtn, { backgroundColor: "#F0FDF4", borderColor: "#D1FAE5" }]}
                onPress={() => changeStatus("active")} disabled={updating}>
                <Ionicons name="checkmark-circle-outline" size={17} color="#059669" />
                <Text style={[dm.actionTxt, { color: "#059669" }]}>Activate account</Text>
              </TouchableOpacity>
            )}
            {status !== "deactivated" && (
              <TouchableOpacity style={[dm.actionBtn, { backgroundColor: GRAY1, borderColor: GRAY2 }]}
                onPress={() => changeStatus("deactivated")} disabled={updating}>
                <Ionicons name="pause-circle-outline" size={17} color={GRAY4} />
                <Text style={[dm.actionTxt, { color: GRAY4 }]}>Deactivate account</Text>
              </TouchableOpacity>
            )}
            {status !== "blocked" && (
              <TouchableOpacity style={[dm.actionBtn, { backgroundColor: "#FFF5F5", borderColor: "#FEE2E2" }]}
                onPress={() => changeStatus("blocked")} disabled={updating}>
                <Ionicons name="ban-outline" size={17} color="#DC2626" />
                <Text style={[dm.actionTxt, { color: "#DC2626" }]}>Block user</Text>
              </TouchableOpacity>
            )}
            {updating && <ActivityIndicator size="small" color={ACCENT} style={{ marginTop: 8 }} />}
          </View>

          {/* Booking history — from cache, 0 reads */}
          <View style={dm.card}>
            <View style={dm.sectionRow}>
              <Text style={dm.sectionLbl}>Booking History</Text>
              <View style={dm.cacheBadge}>
                <Ionicons name="flash" size={10} color={GREEN} />
                <Text style={dm.cacheTxt}>cached</Text>
              </View>
            </View>
            {userBookings.length === 0 ? (
              <Text style={dm.noHistory}>No bookings yet.</Text>
            ) : (
              userBookings.slice(0, 15).map((b: any) => {
                const total  = Number(b.totalAmount ?? b.paidAmount ?? 0);
                const bst    = b.status || "pending";
                const bColor = bst === "confirmed" ? "#059669" : bst === "cancelled" ? "#DC2626" : GRAY4;
                const slots  = Array.isArray(b.selectedSlots) && b.selectedSlots.length
                  ? b.selectedSlots[0] + (b.selectedSlots.length > 1 ? ` +${b.selectedSlots.length-1}` : "")
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
            {userBookings.length > 15 && (
              <Text style={dm.more}>+{userBookings.length - 15} more bookings</Text>
            )}
          </View>

          {/* Danger zone */}
          <View style={[dm.card, { borderWidth: 1, borderColor: "#FEE2E2" }]}>
            <Text style={[dm.sectionLbl, { color: "#DC2626" }]}>Danger Zone</Text>
            <Text style={dm.dangerNote}>
              Deletes this user's Firestore document permanently. Past bookings are kept for records.
            </Text>
            <TouchableOpacity style={dm.deleteBtn} onPress={handleDelete} disabled={updating}>
              <Ionicons name="trash-outline" size={15} color={WHITE} />
              <Text style={dm.deleteBtnTxt}>Delete user permanently</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminUsers() {
  const router = useRouter();

  const [users,        setUsers]        = useState<AppUser[]>([]);
  const [allBookings,  setAllBookings]  = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [search,       setSearch]       = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey,      setSortKey]      = useState<SortKey>("createdAt");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [selected,     setSelected]     = useState<AppUser | null>(null);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [filterOpen,   setFilterOpen]   = useState(false);
  const [dateFrom,     setDateFrom]     = useState<Date>(new Date(new Date().getFullYear(), 0, 1));
  const [dateTo,       setDateTo]       = useState<Date>(new Date());
  const [dateActive,   setDateActive]   = useState(false);

  // Debounce search — 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (forceRefresh = false) => {
    forceRefresh ? setRefreshing(true) : setLoading(true);
    try {
      // ✅ Parallel fetch — users + bookings (bookings from cache after first load)
      const [userSnap, bookings] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "user"), limit(500))),
        getBookingsFromCache(forceRefresh),
      ]);

      // Build stats map from cached bookings — 0 extra reads
      const statsMap: Record<string, { total: number; spent: number; cancelled: number; lastDate: any }> = {};
      bookings.forEach((b: any) => {
        const uid = b.userId; if (!uid) return;
        if (!statsMap[uid]) statsMap[uid] = { total: 0, spent: 0, cancelled: 0, lastDate: null };
        statsMap[uid].total++;
        if (b.status !== "cancelled") statsMap[uid].spent += Number(b.totalAmount ?? b.paidAmount ?? 0);
        if (b.status === "cancelled") statsMap[uid].cancelled++;
        const bd = b.date?.toDate?.() ?? (b.dateString ? new Date(b.dateString) : null);
        if (bd && (!statsMap[uid].lastDate || bd > statsMap[uid].lastDate)) statsMap[uid].lastDate = bd;
      });

      setAllBookings(bookings);
      setUsers(userSnap.docs.map(d => {
        const stat = statsMap[d.id] || { total: 0, spent: 0, cancelled: 0, lastDate: null };
        return {
          id: d.id, ...d.data(),
          totalBookings:    stat.total,
          totalSpent:       stat.spent,
          cancelledBookings:stat.cancelled,
          lastBookingDate:  stat.lastDate,
        } as AppUser;
      }));
    } catch (e: any) {
      Alert.alert("Error", "Could not load users. " + e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ── Summary stats ──────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const now = new Date();
    return {
      total:       users.length,
      active:      users.filter(u => (u.status || "active") === "active").length,
      blocked:     users.filter(u => u.status === "blocked").length,
      newThisMonth:users.filter(u => {
        if (!u.createdAt) return false;
        const d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length,
      totalRevenue: users.reduce((s, u) => s + (u.totalSpent ?? 0), 0),
      withBookings: users.filter(u => (u.totalBookings ?? 0) > 0).length,
    };
  }, [users]);

  // ── Filter + sort + search — all local, 0 reads ────────────────────────────
  const filtered = useMemo(() => {
    let list = [...users];

    // Status filter
    if (filterStatus !== "all")
      list = list.filter(u => (u.status || "active") === filterStatus);

    // Date range filter (joined date)
    if (dateActive) {
      const from = toMidnight(dateFrom);
      const to   = toMidnight(dateTo); to.setHours(23,59,59);
      list = list.filter(u => {
        if (!u.createdAt) return false;
        const d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
        return d >= from && d <= to;
      });
    }

    // Search — debounced, searches 5 fields simultaneously
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(u =>
        [u.name, u.email, u.phone, u.location, u.favoriteSport]
          .some(f => f?.toLowerCase().includes(q))
      );
    }

    // Sort
    list.sort((a, b) => {
      if (sortKey === "name")          return (a.name||"").localeCompare(b.name||"");
      if (sortKey === "totalBookings") return (b.totalBookings??0) - (a.totalBookings??0);
      if (sortKey === "totalSpent")    return (b.totalSpent??0) - (a.totalSpent??0);
      const da  = a.createdAt?.toDate?.() ?? new Date(a.createdAt ?? 0);
      const db2 = b.createdAt?.toDate?.() ?? new Date(b.createdAt ?? 0);
      return db2 - da;
    });

    return list;
  }, [users, filterStatus, debouncedSearch, sortKey, dateActive, dateFrom, dateTo]);

  const activeFilterCount =
    (filterStatus !== "all" ? 1 : 0) +
    (sortKey !== "createdAt" ? 1 : 0) +
    (dateActive ? 1 : 0);

  const openUser = useCallback((u: AppUser) => { setSelected(u); setModalOpen(true); }, []);
  const onUpdated = useCallback((u: AppUser) => {
    setUsers(prev => prev.map(x => x.id === u.id ? u : x));
    setSelected(u);
  }, []);
  const onDeleted = useCallback((id: string) => {
    setUsers(prev => prev.filter(x => x.id !== id));
  }, []);

  const resetFilters = useCallback(() => {
    setFilterStatus("all");
    setSortKey("createdAt");
    setDateActive(false);
  }, []);

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color={GREEN} />
      <Text style={s.loadTxt}>Loading users…</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* ── Everything in one FlatList — header + list scroll together ── */}
      <FlatList
        data={filtered}
        keyExtractor={(u) => u.id}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={GREEN} />
        }
        ListHeaderComponent={
          <View>
            {/* ── Dark header ── */}
            <View style={s.header}>
              <View>
                <Text style={s.headerTag}>Admin · Users</Text>
                <Text style={s.headerTitle}>User Management</Text>
              </View>
              <TouchableOpacity
                style={[s.filterBtn, activeFilterCount > 0 && s.filterBtnActive]}
                onPress={() => setFilterOpen(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="options-outline" size={17} color={activeFilterCount > 0 ? WHITE : GREEN} />
                {activeFilterCount > 0 && (
                  <View style={s.filterBadge}>
                    <Text style={s.filterBadgeTxt}>{activeFilterCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* ── Stats strip ── */}
            <View style={s.statsStrip}>
              {[
                { val: summary.total,             lbl: "Total",   color: WHITE     },
                { val: summary.active,            lbl: "Active",  color: "#4ADE80" },
                { val: summary.blocked,           lbl: "Blocked", color: "#F87171" },
                { val: summary.newThisMonth,      lbl: "New",     color: "#FBBF24" },
                { val: fmt(summary.totalRevenue), lbl: "Revenue", color: "#A78BFA" },
              ].map((st, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <View style={s.stripDiv} />}
                  <View style={s.stripItem}>
                    <Text style={[s.stripVal, { color: st.color }]}>{st.val}</Text>
                    <Text style={s.stripLbl}>{st.lbl}</Text>
                  </View>
                </React.Fragment>
              ))}
            </View>

            {/* ── Search bar — sits in dark section ── */}
            <View style={s.searchDark}>
              <View style={s.searchWrap}>
                <Ionicons name="search-outline" size={16} color={GRAY3} />
                <TextInput
                  style={s.searchInput}
                  placeholder="Search name, email, phone, location, sport…"
                  placeholderTextColor={GRAY3}
                  value={search}
                  onChangeText={setSearch}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
                {search.length > 0 && (
                  <TouchableOpacity onPress={() => setSearch("")}>
                    <Ionicons name="close-circle" size={16} color={GRAY3} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* ── Active filter pills — horizontal row, fixed height ── */}
            {activeFilterCount > 0 && (
              <View style={s.pillsRow}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={s.pillsContent}
                  style={s.pillsScroll}
                >
                  {filterStatus !== "all" && (
                    <TouchableOpacity style={s.activePill} onPress={() => setFilterStatus("all")}>
                      <Text style={s.activePillTxt}>{STATUS_META[filterStatus as UserStatus].label}</Text>
                      <Ionicons name="close" size={11} color={DARK} />
                    </TouchableOpacity>
                  )}
                  {sortKey !== "createdAt" && (
                    <TouchableOpacity style={s.activePill} onPress={() => setSortKey("createdAt")}>
                      <Text style={s.activePillTxt}>
                        {sortKey === "name" ? "Name A–Z" : sortKey === "totalBookings" ? "Most bookings" : "Highest spend"}
                      </Text>
                      <Ionicons name="close" size={11} color={DARK} />
                    </TouchableOpacity>
                  )}
                  {dateActive && (
                    <TouchableOpacity style={s.activePill} onPress={() => setDateActive(false)}>
                      <Text style={s.activePillTxt}>
                        {dateFrom.toLocaleDateString("en-IN",{day:"numeric",month:"short"})} – {dateTo.toLocaleDateString("en-IN",{day:"numeric",month:"short"})}
                      </Text>
                      <Ionicons name="close" size={11} color={DARK} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.clearAllPill} onPress={resetFilters}>
                    <Text style={s.clearAllTxt}>Clear all</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            )}

            {/* ── Result count ── */}
            <View style={s.resultRow}>
              <Text style={s.resultCount}>
                {filtered.length} user{filtered.length !== 1 ? "s" : ""}
                {debouncedSearch ? ` for "${debouncedSearch}"` : ""}
              </Text>
              {debouncedSearch.length > 0 && (
                <View style={s.cacheBadgeRow}>
                  <Ionicons name="flash" size={11} color={GREEN} />
                  <Text style={s.cacheNote}>local · 0 reads</Text>
                </View>
              )}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <UserCard user={item} onPress={() => openUser(item)} />
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="people-outline" size={48} color={GRAY2} />
            <Text style={s.emptyTitle}>No users found</Text>
            <Text style={s.emptySub}>
              {debouncedSearch ? `No match for "${debouncedSearch}"` : "Try different filters."}
            </Text>
          </View>
        }
        ListFooterComponent={<View style={{ height: 120 }} />}
      />

      <AdminNavBar />

      {/* Filter sheet */}
      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filterStatus={filterStatus} setFilterStatus={setFilterStatus}
        sortKey={sortKey} setSortKey={setSortKey}
        dateFrom={dateFrom} dateTo={dateTo} dateActive={dateActive}
        setDateFrom={setDateFrom} setDateTo={setDateTo} setDateActive={setDateActive}
        onReset={() => { resetFilters(); setFilterOpen(false); }}
      />

      {/* User detail modal */}
      <UserDetailModal
        user={selected}
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onUpdated={onUpdated}
        onDeleted={onDeleted}
        allBookings={allBookings}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BODY_BG },
  loadWrap:{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadTxt: { marginTop: 12, color: GRAY3, fontSize: 14, fontWeight: "600" },

  // Header
  header: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 14,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  headerTag:   { color: GREEN, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  headerTitle: { color: WHITE, fontSize: 26, fontWeight: "900", marginTop: 2, letterSpacing: -0.5 },
  filterBtn: {
    width: 42, height: 42, borderRadius: 13,
    backgroundColor: GREEN + "20", borderWidth: 1, borderColor: GREEN + "44",
    alignItems: "center", justifyContent: "center", position: "relative",
  },
  filterBtnActive: { backgroundColor: DARK, borderColor: GREEN },
  filterBadge: {
    position: "absolute", top: -4, right: -4,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center",
  },
  filterBadgeTxt: { fontSize: 9, color: WHITE, fontWeight: "900" },

  // Stats strip (inside dark header area)
  statsStrip: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: DARK,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  stripItem: { flex: 1, alignItems: "center" },
  stripVal:  { fontSize: 14, fontWeight: "900" },
  stripLbl:  { fontSize: 9, color: "#64748B", marginTop: 2, textAlign: "center" },
  stripDiv:  { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.08)" },

  // Search
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: WHITE, paddingHorizontal: 14,
    marginHorizontal: 16, marginTop: 0, marginBottom: 0,
    borderRadius: 13, borderWidth: 1, borderColor: GRAY2, height: 46,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  searchInput: { flex: 1, fontSize: 14, color: DARK, fontWeight: "500" },
  searchDark:{
    marginTop:10,
  },

  // Active filter pills
  // Pills row — fixed height, never expands vertically
  pillsRow:     { height: 44, marginTop: 10, marginBottom: 2 },
  pillsScroll:  { flex: 1 },
  pillsContent: { paddingHorizontal: 16, gap: 7, alignItems: "center", flexDirection: "row" },
  activePill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: DARK + "12", borderWidth: 1, borderColor: DARK + "20",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    height: 30,
  },
  activePillTxt: { fontSize: 11, fontWeight: "700", color: DARK },
  clearAllPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#FECACA",
    height: 30, justifyContent: "center",
  },
  clearAllTxt: { fontSize: 11, fontWeight: "700", color: "#DC2626" },

  // Result row
  resultRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  resultCount:  { fontSize: 11, color: GRAY3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, paddingLeft: 4 },
  cacheBadgeRow:{ flexDirection: "row", alignItems: "center", gap: 3 },
  cacheNote:    { fontSize: 10, color: GREEN, fontWeight: "600" },

  list:  { paddingTop: 0 },
  empty: { alignItems: "center", paddingVertical: 80, marginHorizontal: 16 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: DARK, marginTop: 14 },
  emptySub:   { fontSize: 13, color: GRAY3, marginTop: 6, textAlign: "center" },
});

// ─── User card styles ─────────────────────────────────────────────────────────
const uc = StyleSheet.create({
  card: {
    flexDirection: "row", backgroundColor: WHITE,
    borderRadius: 16, marginBottom: 10, marginHorizontal: 16,
    borderWidth: 1, borderColor: GRAY2, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  bar:       { width: 4, flexShrink: 0 },
  inner:     { flex: 1, padding: 13 },
  top:       { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  avatar:    { width: 46, height: 46, borderRadius: 23, justifyContent: "center", alignItems: "center" },
  avatarTxt: { fontSize: 16, fontWeight: "800", color: WHITE },
  nameRow:   { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 3 },
  name:      { fontSize: 14, fontWeight: "800", color: DARK, flex: 1 },
  pill:      { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  pillTxt:   { fontSize: 9, fontWeight: "800" },
  meta:      { fontSize: 11, color: GRAY4, marginBottom: 1 },
  statsRow:  { flexDirection: "row", alignItems: "center", backgroundColor: GRAY1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 6, marginBottom: 10 },
  stat:      { flex: 1, alignItems: "center" },
  statVal:   { fontSize: 13, fontWeight: "800", marginBottom: 2 },
  statLbl:   { fontSize: 9, color: GRAY3, textAlign: "center" },
  divider:   { width: 1, height: 26, backgroundColor: GRAY2 },
  footer:    { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  chip:      { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: GRAY1, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  chipTxt:   { fontSize: 10, color: GRAY4 },
  joined:    { fontSize: 10, color: GRAY2, marginLeft: "auto" as any },
});

// ─── Detail modal styles ──────────────────────────────────────────────────────
const dm = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BODY_BG },
  header:  { marginTop:20,  flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: GRAY2, backgroundColor: WHITE, gap: 10 },
  closeBtn:{ marginTop:10,  width: 32, height: 32, borderRadius: 9, backgroundColor: GRAY1, justifyContent: "center", alignItems: "center" },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: DARK },
  badge:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  badgeTxt:{ fontSize: 10, fontWeight: "800" },
  scroll:  { paddingHorizontal: 16, paddingTop: 16 },
  card:    { backgroundColor: WHITE, borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  bigAvatar:   { width: 68, height: 68, borderRadius: 34, justifyContent: "center", alignItems: "center", alignSelf: "center", marginBottom: 12 },
  bigAvatarTxt:{ fontSize: 24, fontWeight: "900", color: WHITE },
  profileName: { fontSize: 19, fontWeight: "900", color: DARK, textAlign: "center", marginBottom: 4 },
  profileSub:  { fontSize: 13, color: GRAY4, textAlign: "center", marginBottom: 2 },
  sportPill:   { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#EEF2FF", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, alignSelf: "center", marginTop: 8 },
  sportTxt:    { fontSize: 12, fontWeight: "600", color: "#6366F1" },
  joined:      { fontSize: 12, color: GRAY3, textAlign: "center", marginTop: 8 },
  sectionLbl:  { fontSize: 11, fontWeight: "800", color: GRAY5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 },
  sectionRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  cacheBadge:  { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: GREEN_LT, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  cacheTxt:    { fontSize: 9, fontWeight: "700", color: GREEN },
  contactRow:  { flexDirection: "row", gap: 8, marginBottom: 12 },
  contactBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: WHITE, paddingVertical: 11, borderRadius: 22, borderWidth: 1, borderColor: GRAY2 },
  contactLbl:  { fontSize: 12, fontWeight: "700" },
  statsGrid:   { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statBox:     { flex: 1, minWidth: "45%", backgroundColor: GRAY1, borderRadius: 10, padding: 12 },
  statVal:     { fontSize: 19, fontWeight: "900", marginBottom: 2 },
  statLbl2:    { fontSize: 10, color: GRAY3 },
  actionBtn:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 13, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  actionTxt:   { fontSize: 14, fontWeight: "600" },
  histRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: GRAY1 },
  histDot:     { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  histTurf:    { fontSize: 13, fontWeight: "600", color: DARK, marginBottom: 2 },
  histMeta:    { fontSize: 11, color: GRAY3 },
  histAmt:     { fontSize: 13, fontWeight: "700", color: DARK },
  histSt:      { fontSize: 9, fontWeight: "800", marginTop: 2 },
  noHistory:   { fontSize: 13, color: GRAY3, textAlign: "center", paddingVertical: 20 },
  more:        { fontSize: 12, color: GRAY3, textAlign: "center", marginTop: 8 },
  dangerNote:  { fontSize: 13, color: GRAY4, marginBottom: 14, lineHeight: 20 },
  deleteBtn:   { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#DC2626", paddingVertical: 13, borderRadius: 12, justifyContent: "center" },
  deleteBtnTxt:{ fontSize: 14, fontWeight: "700", color: WHITE },
});

// ─── Filter sheet styles ──────────────────────────────────────────────────────
const fs = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:     { backgroundColor: WHITE, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, maxHeight: "85%", paddingBottom: Platform.OS === "ios" ? 34 : 20 },
  handle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: GRAY2, alignSelf: "center", marginBottom: 16 },
  header:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  title:     { fontSize: 18, fontWeight: "900", color: DARK },
  resetBtn:  { flexDirection: "row", alignItems: "center", gap: 5 },
  resetTxt:  { fontSize: 13, color: GRAY4, fontWeight: "600" },
  groupLabel:{ fontSize: 11, fontWeight: "800", color: GRAY5, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, marginTop: 16 },
  chipRow:   { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, backgroundColor: WHITE, borderWidth: 1, borderColor: GRAY2 },
  chipTxt:   { fontSize: 12, fontWeight: "600", color: GRAY5 },
  dateHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clearDate: { fontSize: 13, color: "#DC2626", fontWeight: "600" },
  datePillRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 10 },
  datePill:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: GRAY1, borderRadius: 12, padding: 12, borderWidth: 1.5, borderColor: GRAY2 },
  datePillActive: { backgroundColor: DARK, borderColor: DARK },
  datePillLabel:  { fontSize: 9, fontWeight: "800", color: GRAY3, textTransform: "uppercase", letterSpacing: 0.5 },
  datePillValue:  { fontSize: 14, fontWeight: "800", color: DARK, marginTop: 2 },
  applyBtn:  { backgroundColor: GREEN, paddingVertical: 15, borderRadius: 13, alignItems: "center", marginTop: 20, shadowColor: GREEN, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  applyTxt:  { color: WHITE, fontWeight: "900", fontSize: 15 },
});

// ─── Inline calendar styles ───────────────────────────────────────────────────
const ic = StyleSheet.create({
  wrap:    { backgroundColor: GRAY1, borderRadius: 13, padding: 12, borderWidth: 1, borderColor: GRAY2, marginBottom: 4 },
  nav:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  navBtn:  { width: 32, height: 32, borderRadius: 9, backgroundColor: WHITE, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: GRAY2 },
  month:   { fontSize: 14, fontWeight: "800", color: DARK },
  weekRow: { flexDirection: "row", marginBottom: 6 },
  weekDay: { flex: 1, textAlign: "center", fontSize: 10, fontWeight: "700", color: GRAY3 },
  grid:    { flexDirection: "row", flexWrap: "wrap" },
  cell:    { width: "14.28%", aspectRatio: 1, justifyContent: "center", alignItems: "center", padding: 2 },
  cellSel: { backgroundColor: DARK, borderRadius: 9 },
  cellTod: { backgroundColor: GREEN_LT, borderRadius: 9, borderWidth: 1.5, borderColor: GREEN },
  dayTxt:    { fontSize: 13, fontWeight: "600", color: GRAY5 },
  dayTxtSel: { color: WHITE, fontWeight: "800" },
  dayTxtTod: { color: GREEN, fontWeight: "800" },
  dayTxtDis: { color: GRAY2 },
  
});
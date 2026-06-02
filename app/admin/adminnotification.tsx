import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar, FlatList,
  TouchableOpacity, Alert, ActivityIndicator, RefreshControl,
  Modal, ScrollView, Platform,
} from "react-native";
import { collection, getDocs, query, where, orderBy, limit, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import AdminNavBar from "./adminavabar";

// ─── Tokens ───────────────────────────────────────────────────────────────────
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
const RED     = "#DC2626";
const RED_LT  = "#FEE2E2";
const AMBER   = "#D97706";
const AMBER_LT= "#FEF3C7";
const BLUE    = "#2563EB";
const BLUE_LT = "#DBEAFE";
const PURPLE  = "#7C3AED";
const PURPLE_LT = "#EDE9FE";

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab = "cancellations" | "tickets";

type CancelledBooking = {
  id: string;
  userName?: string; userPhone?: string; userEmail?: string;
  turfName?: string; ownerName?: string;
  date?: any; dateString?: string; createdAt?: any; cancelledAt?: any;
  totalAmount?: number; paidAmount?: number; advanceAmount?: number;
  remainingAmount?: number; bookingType?: string; paymentStatus?: string;
  paymentMode?: string; refundStatus?: string; refundAmount?: number;
  cancellationReason?: string; cancelledBy?: string;
  selectedSlots?: string[]; orderId?: string; paymentId?: string;
};

type SupportTicket = {
  id: string;
  source?: "user" | "owner";
  status?: string; priority?: string;
  category?: string; subject?: string; message?: string;
  userName?: string; ownerName?: string;
  userEmail?: string; ownerEmail?: string;
  userPhone?: string; ownerPhone?: string;
  turfName?: string; createdAt?: any;
  replies?: any[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSafeDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(v: any): string {
  const d = getSafeDate(v);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function timeAgo(v: any): string {
  const d = getSafeDate(v);
  if (!d) return "—";
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)     return "just now";
  if (diff < 3600)   return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return fmtDate(v);
}

function fmt(n: number): string {
  return n >= 1000 ? `₹${(n/1000).toFixed(1)}K` : `₹${n}`;
}

function mergeSlots(slots: string[]): string {
  if (!slots?.length) return "—";
  // Just show first and last time
  const first = slots[0].split(" - ")[0];
  const last  = slots[slots.length-1].split(" - ")[1] || slots[slots.length-1];
  return slots.length === 1 ? slots[0] : `${first} – ${last}`;
}

const REFUND_CFG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  "not_applicable": { label: "No Refund",   color: GRAY4,  bg: GRAY1,     icon: "remove-circle-outline"    },
  "pending":        { label: "Refund Due",  color: AMBER,  bg: AMBER_LT,  icon: "hourglass-outline"         },
  "processed":      { label: "Refunded",    color: GREEN,  bg: GREEN_LT,  icon: "checkmark-circle"          },
  "failed":         { label: "Failed",      color: RED,    bg: RED_LT,    icon: "close-circle"              },
};
const getRefundCfg = (s?: string) => REFUND_CFG[s || "not_applicable"] ?? REFUND_CFG["not_applicable"];

const TICKET_STATUS_CFG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  "open":        { label: "Open",        color: RED,    bg: RED_LT,    icon: "alert-circle"     },
  "in-progress": { label: "In Progress", color: AMBER,  bg: AMBER_LT,  icon: "time"             },
  "resolved":    { label: "Resolved",    color: GREEN,  bg: GREEN_LT,  icon: "checkmark-circle" },
  "closed":      { label: "Closed",      color: GRAY4,  bg: GRAY1,     icon: "close-circle"     },
};
const getTicketCfg = (s?: string) => TICKET_STATUS_CFG[s || "open"] ?? TICKET_STATUS_CFG["open"];

// ─── Cancellation Detail Modal ────────────────────────────────────────────────
function CancelDetailModal({ item, visible, onClose }: {
  item: CancelledBooking | null; visible: boolean; onClose: () => void;
}) {
  if (!item) return null;
  const rc = getRefundCfg(item.refundStatus);
  const paid = Number(item.paidAmount ?? item.advanceAmount ?? 0);
  const refund = Number(item.refundAmount ?? 0);
  const isAdvance = item.bookingType === "advance";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={m.backdrop}>
        <View style={m.sheet}>
          <View style={m.handle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

            {/* Header */}
            <View style={m.header}>
              <View style={[m.iconCircle, { backgroundColor: RED_LT }]}>
                <Ionicons name="close-circle" size={22} color={RED} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={m.modalTitle}>Cancelled Booking</Text>
                <Text style={m.modalSub}>#{item.id.slice(0,14)}</Text>
              </View>
              <TouchableOpacity style={m.closeBtn} onPress={onClose}>
                <Ionicons name="close" size={18} color={GRAY5} />
              </TouchableOpacity>
            </View>

            {/* Refund status banner */}
            <View style={[m.banner, { backgroundColor: rc.bg, borderColor: rc.color + "33" }]}>
              <Ionicons name={rc.icon as any} size={20} color={rc.color} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[m.bannerTitle, { color: rc.color }]}>{rc.label}</Text>
                <Text style={[m.bannerSub, { color: rc.color + "99" }]}>
                  {item.refundStatus === "not_applicable"
                    ? "Advance booking — no online refund needed. Cash due at turf."
                    : item.refundStatus === "pending"
                    ? `₹${paid} was collected online — refund needs to be processed.`
                    : item.refundStatus === "processed"
                    ? `₹${refund} refunded successfully.`
                    : "Refund failed — needs manual action."}
                </Text>
              </View>
            </View>

            {/* Customer */}
            <Text style={m.sectionLbl}>Customer</Text>
            <View style={m.block}>
              <DetailRow icon="person-outline"  label="Name"  value={item.userName  || "—"} />
              <DetailRow icon="call-outline"    label="Phone" value={item.userPhone || "—"} />
              <DetailRow icon="mail-outline"    label="Email" value={item.userEmail || "—"} last />
            </View>

            {/* Booking */}
            <Text style={m.sectionLbl}>Booking Details</Text>
            <View style={m.block}>
              <DetailRow icon="location-outline" label="Turf"    value={item.turfName  || "—"} />
              <DetailRow icon="people-outline"   label="Owner"   value={item.ownerName || "—"} />
              <DetailRow icon="calendar-outline" label="Date"    value={fmtDate(item.date || item.dateString)} />
              <DetailRow icon="time-outline"     label="Slots"   value={mergeSlots(item.selectedSlots || [])} />
              <DetailRow icon="card-outline"     label="Type"    value={item.bookingType === "full" ? "Full Payment" : "Advance"} last />
            </View>

            {/* Payment */}
            <Text style={m.sectionLbl}>Payment & Refund</Text>
            <View style={m.block}>
              <DetailRow icon="cash-outline"             label="Total booking value" value={`₹${item.totalAmount ?? 0}`} />
              <DetailRow icon="checkmark-circle-outline" label="Paid online"         value={`₹${paid}`} valueColor={BLUE} />
              <DetailRow icon="receipt-outline"          label="Remaining (cash)"    value={`₹${item.remainingAmount ?? 0}`} valueColor={GRAY4} />
              <DetailRow icon="refresh-circle-outline"   label="Refund status"       value={rc.label} valueColor={rc.color} />
              <DetailRow icon="cash-outline"             label="Refund amount"       value={refund > 0 ? `₹${refund}` : "—"} last />
            </View>

            {/* What to do */}
            <View style={m.actionBox}>
              <Ionicons name="bulb-outline" size={16} color={AMBER} />
              <Text style={m.actionTxt}>
                {isAdvance
                  ? `Advance booking — customer paid ₹${paid} online. Remaining ₹${item.remainingAmount ?? 0} was to be paid at turf (not collected). ${paid > 0 ? `Check if ₹${paid} refund is needed.` : "No refund needed."}`
                  : `Full payment booking — customer paid ₹${paid} online. ${item.refundStatus === "pending" ? `Process ₹${paid} refund via Razorpay dashboard.` : "Refund already handled."}`}
              </Text>
            </View>

            {item.cancellationReason && (
              <View style={m.reasonBox}>
                <Text style={m.reasonLbl}>Cancellation Reason</Text>
                <Text style={m.reasonTxt}>{item.cancellationReason}</Text>
              </View>
            )}

            {item.orderId && (
              <View style={m.block}>
                <DetailRow icon="receipt-outline" label="Order ID"   value={item.orderId}   />
                <DetailRow icon="card-outline"    label="Payment ID" value={item.paymentId || "—"} last />
              </View>
            )}

            <TouchableOpacity style={m.closeFullBtn} onPress={onClose}>
              <Text style={m.closeFullBtnTxt}>Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Ticket Detail Modal ──────────────────────────────────────────────────────
function TicketDetailModal({ item, visible, onClose }: {
  item: SupportTicket | null; visible: boolean; onClose: () => void;
}) {
  if (!item) return null;
  const tc  = getTicketCfg(item.status);
  const src = item.source === "owner"
    ? { name: item.ownerName, phone: item.ownerPhone, email: item.ownerEmail, label: "Owner" }
    : { name: item.userName,  phone: item.userPhone,  email: item.userEmail,  label: "User"  };
  const replyCount = item.replies?.length ?? 0;
  const needsReply = replyCount === 0 && item.status === "open";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={m.backdrop}>
        <View style={m.sheet}>
          <View style={m.handle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

            {/* Header */}
            <View style={m.header}>
              <View style={[m.iconCircle, { backgroundColor: item.priority === "high" ? RED_LT : BLUE_LT }]}>
                <Ionicons name={item.priority === "high" ? "flame" : "chatbubble-ellipses"} size={20}
                  color={item.priority === "high" ? RED : BLUE} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={m.modalTitle} numberOfLines={2}>{item.subject || item.category}</Text>
                <Text style={m.modalSub}>#{item.id.slice(0,12)}</Text>
              </View>
              <TouchableOpacity style={m.closeBtn} onPress={onClose}>
                <Ionicons name="close" size={18} color={GRAY5} />
              </TouchableOpacity>
            </View>

            {/* Status banner */}
            <View style={[m.banner, { backgroundColor: tc.bg, borderColor: tc.color + "33" }]}>
              <Ionicons name={tc.icon as any} size={20} color={tc.color} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[m.bannerTitle, { color: tc.color }]}>{tc.label}</Text>
                <Text style={[m.bannerSub, { color: tc.color + "AA" }]}>
                  {needsReply
                    ? "No reply yet — needs your attention now."
                    : replyCount > 0
                    ? `${replyCount} repl${replyCount === 1 ? "y" : "ies"} sent.`
                    : "In queue."}
                </Text>
              </View>
              {needsReply && (
                <View style={m.urgentDot} />
              )}
            </View>

            {/* Sender */}
            <Text style={m.sectionLbl}>From ({src.label})</Text>
            <View style={m.block}>
              <DetailRow icon="person-outline" label="Name"  value={src.name  || "—"} />
              <DetailRow icon="call-outline"   label="Phone" value={src.phone || "—"} />
              <DetailRow icon="mail-outline"   label="Email" value={src.email || "—"} last />
            </View>

            {/* Ticket info */}
            <Text style={m.sectionLbl}>Ticket Info</Text>
            <View style={m.block}>
              <DetailRow icon="pricetag-outline"    label="Category" value={item.category || "—"} />
              <DetailRow icon="calendar-outline"    label="Opened"   value={fmtDate(item.createdAt)} />
              <DetailRow icon="time-outline"        label="Time ago"  value={timeAgo(item.createdAt)} />
              <DetailRow icon="chatbubble-outline"  label="Replies"  value={String(replyCount)} last />
            </View>

            {/* Message */}
            <Text style={m.sectionLbl}>Message</Text>
            <View style={[m.block, { padding: 14 }]}>
              <Text style={m.messageText}>{item.message || "—"}</Text>
            </View>

            {/* Action hint */}
            <View style={[m.actionBox, needsReply && { backgroundColor: RED_LT, borderColor: "#FECACA" }]}>
              <Ionicons name={needsReply ? "alert-circle-outline" : "information-circle-outline"} size={16}
                color={needsReply ? RED : AMBER} />
              <Text style={[m.actionTxt, needsReply && { color: RED }]}>
                {needsReply
                  ? "This ticket has no replies yet. Go to Support screen to reply immediately."
                  : item.status === "in-progress"
                  ? "Ticket is in progress. Follow up if needed."
                  : "Ticket has been responded to."}
              </Text>
            </View>

            {/* Replies preview */}
            {(item.replies || []).length > 0 && (
              <>
                <Text style={m.sectionLbl}>Last Reply</Text>
                <View style={[m.block, { padding: 14 }]}>
                  {(() => {
                    const last = item.replies![item.replies!.length - 1];
                    return (
                      <>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: last.by === "Admin" ? GREEN : BLUE }}>
                            {last.by}
                          </Text>
                          <Text style={{ fontSize: 11, color: GRAY3 }}>{timeAgo(last.at)}</Text>
                        </View>
                        <Text style={m.messageText}>{last.text}</Text>
                      </>
                    );
                  })()}
                </View>
              </>
            )}

            <TouchableOpacity style={m.closeFullBtn} onPress={onClose}>
              <Text style={m.closeFullBtnTxt}>Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Detail Row ───────────────────────────────────────────────────────────────
function DetailRow({ icon, label, value, valueColor, last }: {
  icon: string; label: string; value: string; valueColor?: string; last?: boolean;
}) {
  return (
    <View style={[dr.row, !last && dr.border]}>
      <View style={dr.iconWrap}>
        <Ionicons name={icon as any} size={14} color={GRAY4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={dr.label}>{label}</Text>
        <Text style={[dr.value, valueColor ? { color: valueColor } : {}]} numberOfLines={2}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Cancellation Card ────────────────────────────────────────────────────────
const CancelCard = React.memo(function CancelCard({ item, onPress }: {
  item: CancelledBooking; onPress: () => void;
}) {
  const rc   = getRefundCfg(item.refundStatus);
  const paid = Number(item.paidAmount ?? item.advanceAmount ?? 0);
  const needsAttention = item.refundStatus === "pending" || item.refundStatus === "failed";

  return (
    <TouchableOpacity style={[c.card, needsAttention && c.cardUrgent]} onPress={onPress} activeOpacity={0.85}>
      <View style={[c.bar, { backgroundColor: needsAttention ? RED : GRAY3 }]} />
      <View style={c.inner}>
        {/* Top */}
        <View style={c.top}>
          <View style={{ flex: 1 }}>
            <Text style={c.name} numberOfLines={1}>{item.userName || "Unknown"}</Text>
            <Text style={c.turf} numberOfLines={1}>{item.turfName || "Unknown Turf"}</Text>
          </View>
          <View style={[c.refundBadge, { backgroundColor: rc.bg }]}>
            <Ionicons name={rc.icon as any} size={11} color={rc.color} />
            <Text style={[c.refundTxt, { color: rc.color }]}>{rc.label}</Text>
          </View>
        </View>

        {/* Chips */}
        <View style={c.chipRow}>
          <View style={c.chip}>
            <Ionicons name="calendar-outline" size={11} color={GRAY3} />
            <Text style={c.chipTxt}>{fmtDate(item.date || item.dateString)}</Text>
          </View>
          <View style={c.chip}>
            <Ionicons name="time-outline" size={11} color={GRAY3} />
            <Text style={c.chipTxt}>{mergeSlots(item.selectedSlots || [])}</Text>
          </View>
          <View style={c.chip}>
            <Ionicons name={item.bookingType === "full" ? "card-outline" : "wallet-outline"} size={11} color={GRAY3} />
            <Text style={c.chipTxt}>{item.bookingType === "full" ? "Full pay" : "Advance"}</Text>
          </View>
        </View>

        {/* Payment row */}
        <View style={c.payRow}>
          <View>
            <Text style={c.payAmt}>{fmt(Number(item.totalAmount ?? 0))}</Text>
            <Text style={c.paySub}>Paid online: {fmt(paid)}</Text>
          </View>
          <View style={c.timeWrap}>
            <Ionicons name="time-outline" size={11} color={GRAY3} />
            <Text style={c.timeAgo}>{timeAgo(item.createdAt)}</Text>
          </View>
        </View>

        {/* Urgent alert */}
        {needsAttention && (
          <View style={c.urgentBar}>
            <Ionicons name="alert-circle" size={13} color={RED} />
            <Text style={c.urgentTxt}>
              {item.refundStatus === "pending"
                ? `₹${paid} refund pending — action needed`
                : "Refund failed — check Razorpay"}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

// ─── Ticket Card ──────────────────────────────────────────────────────────────
const TicketCard = React.memo(function TicketCard({ item, onPress }: {
  item: SupportTicket; onPress: () => void;
}) {
  const tc         = getTicketCfg(item.status);
  const isHigh     = item.priority === "high";
  const replyCount = item.replies?.length ?? 0;
  const noReply    = replyCount === 0;
  const senderName = item.source === "owner" ? item.ownerName : item.userName;

  return (
    <TouchableOpacity style={[c.card, (isHigh || noReply) && c.cardUrgent]} onPress={onPress} activeOpacity={0.85}>
      <View style={[c.bar, { backgroundColor: isHigh ? RED : noReply ? AMBER : GRAY3 }]} />
      <View style={c.inner}>
        {/* Top */}
        <View style={c.top}>
          <View style={{ flex: 1 }}>
            <Text style={c.name} numberOfLines={1}>{item.subject || item.category || "Support Ticket"}</Text>
            <Text style={c.turf} numberOfLines={1}>
              {senderName || "Unknown"} · {item.source === "owner" ? "Owner" : "User"}
            </Text>
          </View>
          <View style={[c.refundBadge, { backgroundColor: tc.bg }]}>
            <Ionicons name={tc.icon as any} size={11} color={tc.color} />
            <Text style={[c.refundTxt, { color: tc.color }]}>{tc.label}</Text>
          </View>
        </View>

        {/* Message preview */}
        <Text style={c.preview} numberOfLines={2}>{item.message || "—"}</Text>

        {/* Chips */}
        <View style={c.chipRow}>
          <View style={c.chip}>
            <Ionicons name="pricetag-outline" size={11} color={GRAY3} />
            <Text style={c.chipTxt}>{item.category || "General"}</Text>
          </View>
          <View style={c.chip}>
            <Ionicons name="chatbubble-outline" size={11} color={GRAY3} />
            <Text style={c.chipTxt}>{replyCount} repl{replyCount === 1 ? "y" : "ies"}</Text>
          </View>
          {isHigh && (
            <View style={[c.chip, { backgroundColor: RED_LT, borderColor: "#FECACA" }]}>
              <Ionicons name="flame" size={11} color={RED} />
              <Text style={[c.chipTxt, { color: RED }]}>Urgent</Text>
            </View>
          )}
        </View>

        {/* Time */}
        <View style={c.payRow}>
          <View style={c.timeWrap}>
            <Ionicons name="time-outline" size={11} color={GRAY3} />
            <Text style={c.timeAgo}>{timeAgo(item.createdAt)}</Text>
          </View>
        </View>

        {/* No reply alert */}
        {noReply && item.status === "open" && (
          <View style={[c.urgentBar, { backgroundColor: AMBER_LT, borderColor: "#FDE68A" }]}>
            <Ionicons name="alert-circle" size={13} color={AMBER} />
            <Text style={[c.urgentTxt, { color: AMBER }]}>No reply yet — respond in Support screen</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminNotificationCenter() {
  const [tab,          setTab]          = useState<Tab>("cancellations");
  const [cancellations,setCancellations]= useState<CancelledBooking[]>([]);
  const [tickets,      setTickets]      = useState<SupportTicket[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [selCancel,    setSelCancel]    = useState<CancelledBooking | null>(null);
  const [selTicket,    setSelTicket]    = useState<SupportTicket | null>(null);
  const [cancelModal,  setCancelModal]  = useState(false);
  const [ticketModal,  setTicketModal]  = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [cancelSnap, ticketSnap] = await Promise.all([
        // Cancelled bookings — last 30 days, latest first
        getDocs(query(
          collection(db, "bookings"),
          where("status", "==", "cancelled"),
          orderBy("createdAt", "desc"),
          limit(100)
        )),
        // Open + in-progress tickets, latest first
        getDocs(query(
          collection(db, "supportTickets"),
          where("status", "in", ["open", "in-progress"]),
          orderBy("createdAt", "desc"),
          limit(100)
        )),
      ]);

      setCancellations(cancelSnap.docs.map(d => ({ id: d.id, ...d.data() } as CancelledBooking)));
      setTickets(ticketSnap.docs.map(d => ({ id: d.id, ...d.data() } as SupportTicket)));
    } catch (e: any) {
      Alert.alert("Error", "Could not load notifications. " + (e?.message || ""));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Counts for badges
  const pendingRefunds  = cancellations.filter(b => b.refundStatus === "pending" || b.refundStatus === "failed").length;
  const unrepliedTickets= tickets.filter(t => (t.replies?.length ?? 0) === 0 && t.status === "open").length;
  const urgentTickets   = tickets.filter(t => t.priority === "high" && t.status === "open").length;

  const openCancel  = useCallback((item: CancelledBooking) => { setSelCancel(item); setCancelModal(true); }, []);
  const openTicket  = useCallback((item: SupportTicket)     => { setSelTicket(item); setTicketModal(true); }, []);

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color={GREEN} />
      <Text style={s.loadTxt}>Loading notifications…</Text>
    </SafeAreaView>
  );

  const showCancellations = tab === "cancellations";
  const listData = showCancellations ? cancellations : tickets;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <FlatList
        data={listData as any[]}
        keyExtractor={item => item.id}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={GREEN} />}
        renderItem={({ item }) =>
          showCancellations
            ? <CancelCard  item={item as CancelledBooking} onPress={() => openCancel(item)} />
            : <TicketCard  item={item as SupportTicket}    onPress={() => openTicket(item)} />
        }

        ListHeaderComponent={
          <View>
            {/* ── Dark header ── */}
            <View style={s.header}>
              <View>
                <Text style={s.headerTag}>Admin · Notifications</Text>
                <Text style={s.headerTitle}>Notification Center</Text>
              </View>
              {/* Summary badges */}
              <View style={s.badgeCol}>
                {pendingRefunds > 0 && (
                  <View style={s.alertBadge}>
                    <Ionicons name="refresh-circle" size={13} color={RED} />
                    <Text style={s.alertBadgeTxt}>{pendingRefunds} refund{pendingRefunds > 1 ? "s" : ""} due</Text>
                  </View>
                )}
                {urgentTickets > 0 && (
                  <View style={[s.alertBadge, { backgroundColor: AMBER_LT, borderColor: "#FDE68A" }]}>
                    <Ionicons name="flame" size={13} color={AMBER} />
                    <Text style={[s.alertBadgeTxt, { color: AMBER }]}>{urgentTickets} urgent</Text>
                  </View>
                )}
              </View>
            </View>

            {/* ── Stats strip ── */}
            <View style={s.statsStrip}>
              {[
                { val: cancellations.length, lbl: "Cancellations", color: WHITE        },
                { val: pendingRefunds,        lbl: "Refunds Due",   color: "#F87171"    },
                { val: tickets.length,        lbl: "Open Tickets",  color: "#FBBF24"    },
                { val: unrepliedTickets,      lbl: "No Reply",      color: "#F87171"    },
                { val: urgentTickets,         lbl: "Urgent",        color: "#FCA5A5"    },
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

            {/* ── Tabs ── */}
            <View style={s.tabsWrap}>
              <TouchableOpacity
                style={[s.tabBtn, showCancellations && s.tabBtnActive]}
                onPress={() => setTab("cancellations")}
                activeOpacity={0.8}
              >
                <Ionicons name="close-circle-outline" size={15}
                  color={showCancellations ? WHITE : GRAY4} />
                <Text style={[s.tabTxt, showCancellations && s.tabTxtActive]}>
                  Cancellations
                </Text>
                {pendingRefunds > 0 && (
                  <View style={s.tabBadge}>
                    <Text style={s.tabBadgeTxt}>{pendingRefunds}</Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.tabBtn, !showCancellations && s.tabBtnActive]}
                onPress={() => setTab("tickets")}
                activeOpacity={0.8}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={15}
                  color={!showCancellations ? WHITE : GRAY4} />
                <Text style={[s.tabTxt, !showCancellations && s.tabTxtActive]}>
                  Support Tickets
                </Text>
                {unrepliedTickets > 0 && (
                  <View style={[s.tabBadge, { backgroundColor: AMBER }]}>
                    <Text style={s.tabBadgeTxt}>{unrepliedTickets}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Result count */}
            <View style={s.resultRow}>
              <Text style={s.resultCount}>
                {listData.length} {showCancellations ? "cancellation" : "ticket"}{listData.length !== 1 ? "s" : ""}
              </Text>
              {showCancellations && pendingRefunds > 0 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: RED }} />
                  <Text style={{ fontSize: 11, color: RED, fontWeight: "700" }}>
                    {pendingRefunds} need refund
                  </Text>
                </View>
              )}
              {!showCancellations && unrepliedTickets > 0 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: AMBER }} />
                  <Text style={{ fontSize: 11, color: AMBER, fontWeight: "700" }}>
                    {unrepliedTickets} awaiting reply
                  </Text>
                </View>
              )}
            </View>
          </View>
        }

        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons
              name={showCancellations ? "checkmark-circle-outline" : "chatbubbles-outline"}
              size={52} color={GRAY2}
            />
            <Text style={s.emptyTitle}>
              {showCancellations ? "No cancellations" : "No open tickets"}
            </Text>
            <Text style={s.emptySub}>
              {showCancellations
                ? "All good — no cancelled bookings to review."
                : "All tickets are resolved or closed."}
            </Text>
          </View>
        }

        ListFooterComponent={<View style={{ height: 120 }} />}
      />

      <AdminNavBar />

      <CancelDetailModal item={selCancel} visible={cancelModal} onClose={() => setCancelModal(false)} />
      <TicketDetailModal item={selTicket} visible={ticketModal} onClose={() => setTicketModal(false)} />
    </SafeAreaView>
  );
}

// ─── Card styles ──────────────────────────────────────────────────────────────
const c = StyleSheet.create({
  card: {
    flexDirection: "row", backgroundColor: WHITE,
    marginHorizontal: 16, marginBottom: 10,
    borderRadius: 16, borderWidth: 1, borderColor: GRAY2,
    overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardUrgent: { borderColor: "#FECACA" },
  bar:        { width: 4, flexShrink: 0 },
  inner:      { flex: 1, padding: 13 },
  top:        { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  name:       { fontSize: 14, fontWeight: "800", color: DARK },
  turf:       { fontSize: 12, color: GRAY4, marginTop: 2, fontWeight: "500" },
  refundBadge:{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  refundTxt:  { fontSize: 10, fontWeight: "800" },
  preview:    { fontSize: 13, color: GRAY4, lineHeight: 18, marginBottom: 8 },
  chipRow:    { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 8 },
  chip:       { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: GRAY1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: GRAY2 },
  chipTxt:    { fontSize: 10, color: GRAY5, fontWeight: "600" },
  payRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTopWidth: 1, borderTopColor: GRAY1 },
  payAmt:     { fontSize: 15, fontWeight: "900", color: DARK },
  paySub:     { fontSize: 11, color: GRAY3, marginTop: 2 },
  timeWrap:   { flexDirection: "row", alignItems: "center", gap: 4 },
  timeAgo:    { fontSize: 11, color: GRAY3, fontWeight: "600" },
  urgentBar:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: RED_LT, borderRadius: 8, padding: 8, marginTop: 8, borderWidth: 1, borderColor: "#FECACA" },
  urgentTxt:  { fontSize: 11, fontWeight: "700", color: RED, flex: 1 },
});

// ─── Modal styles ─────────────────────────────────────────────────────────────
const m = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:      { backgroundColor: WHITE, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 12, maxHeight: "94%", paddingBottom: Platform.OS === "ios" ? 34 : 16 },
  handle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: GRAY2, alignSelf: "center", marginBottom: 16 },
  header:     { flexDirection: "row", alignItems: "flex-start", marginBottom: 14, gap: 0 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center", flexShrink: 0 },
  modalTitle: { fontSize: 16, fontWeight: "900", color: DARK, lineHeight: 22 },
  modalSub:   { fontSize: 11, color: GRAY3, marginTop: 2 },
  closeBtn:   { width: 32, height: 32, borderRadius: 9, backgroundColor: GRAY1, alignItems: "center", justifyContent: "center", marginLeft: 8, flexShrink: 0 },
  banner:     { flexDirection: "row", alignItems: "flex-start", borderRadius: 13, padding: 13, marginBottom: 14, borderWidth: 1 },
  bannerTitle:{ fontSize: 13, fontWeight: "800" },
  bannerSub:  { fontSize: 12, marginTop: 3, lineHeight: 17 },
  urgentDot:  { width: 10, height: 10, borderRadius: 5, backgroundColor: RED, marginLeft: 8, marginTop: 4, flexShrink: 0 },
  sectionLbl: { fontSize: 11, fontWeight: "800", color: GRAY3, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6, marginTop: 4 },
  block:      { backgroundColor: WHITE, borderRadius: 13, borderWidth: 1, borderColor: GRAY2, marginBottom: 12, overflow: "hidden" },
  actionBox:  { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: AMBER_LT, borderRadius: 11, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#FDE68A" },
  actionTxt:  { flex: 1, fontSize: 12, color: "#92400E", lineHeight: 18, fontWeight: "500" },
  reasonBox:  { backgroundColor: GRAY1, borderRadius: 11, padding: 12, marginBottom: 12 },
  reasonLbl:  { fontSize: 10, fontWeight: "800", color: GRAY3, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 },
  reasonTxt:  { fontSize: 13, color: GRAY5, lineHeight: 19 },
  messageText:{ fontSize: 14, color: GRAY5, lineHeight: 22 },
  closeFullBtn:    { backgroundColor: GRAY1, paddingVertical: 14, borderRadius: 13, alignItems: "center", marginTop: 8 },
  closeFullBtnTxt: { color: GRAY5, fontWeight: "700", fontSize: 15 },
});

// ─── Detail row styles ────────────────────────────────────────────────────────
const dr = StyleSheet.create({
  row:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
  border: { borderBottomWidth: 1, borderBottomColor: GRAY2 },
  iconWrap:{ width: 28, height: 28, borderRadius: 8, backgroundColor: GRAY1, alignItems: "center", justifyContent: "center" },
  label:  { fontSize: 10, color: GRAY3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  value:  { fontSize: 14, color: DARK, fontWeight: "600", marginTop: 2 },
});

// ─── Screen styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BODY_BG },
  loadWrap:{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadTxt: { marginTop: 12, color: GRAY3, fontSize: 14, fontWeight: "600" },
  list:    { paddingTop: 0 },

  header: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 14,
    paddingBottom: 16,
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
  },
  headerTag:   { color: GREEN, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  headerTitle: { color: WHITE, fontSize: 26, fontWeight: "900", marginTop: 2, letterSpacing: -0.5 },
  badgeCol:    { gap: 6, alignItems: "flex-end", marginTop: 4 },
  alertBadge:  { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: RED_LT, borderWidth: 1, borderColor: "#FECACA", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  alertBadgeTxt:{ fontSize: 11, fontWeight: "700", color: RED },

  statsStrip: { flexDirection: "row", backgroundColor: DARK, paddingHorizontal: 8, paddingBottom: 18 },
  stripItem:  { flex: 1, alignItems: "center" },
  stripVal:   { fontSize: 14, fontWeight: "900" },
  stripLbl:   { fontSize: 8, color: "#64748B", marginTop: 3, textAlign: "center", fontWeight: "600" },
  stripDiv:   { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.08)" },

  tabsWrap: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, gap: 10, backgroundColor: BODY_BG },
  tabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 11, borderRadius: 13, backgroundColor: WHITE,
    borderWidth: 1, borderColor: GRAY2,
  },
  tabBtnActive: { backgroundColor: DARK, borderColor: DARK },
  tabTxt:       { fontSize: 12, fontWeight: "700", color: GRAY4 },
  tabTxtActive: { color: WHITE },
  tabBadge:     { backgroundColor: RED, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, minWidth: 18, alignItems: "center" },
  tabBadgeTxt:  { fontSize: 9, color: WHITE, fontWeight: "900" },

  resultRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 10 },
  resultCount:  { fontSize: 11, color: GRAY3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },

  empty:      { alignItems: "center", paddingVertical: 80, marginHorizontal: 16 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: DARK, marginTop: 16 },
  emptySub:   { fontSize: 13, color: GRAY3, marginTop: 6, textAlign: "center", lineHeight: 20 },
});
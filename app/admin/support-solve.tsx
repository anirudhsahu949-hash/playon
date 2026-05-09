import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, StatusBar,
  Platform, Modal, KeyboardAvoidingView, Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  collection, getDocs, doc, updateDoc, addDoc,
  serverTimestamp, query, orderBy, getDoc,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";
import AdminNavBar from "./adminavabar";

// ─── Theme ────────────────────────────────────────────────────────────────────
const DARK   = "#0F1923";
const ACCENT = "#0EA5A4";
const BG     = "#F0F4F8";

// ─── Types ────────────────────────────────────────────────────────────────────
type TicketStatus = "open" | "in-progress" | "resolved" | "closed";
type TicketSource = "user" | "owner";
type Priority     = "high" | "normal";

interface Reply {
  text: string;
  by: string;
  at: any;
}

interface Ticket {
  id: string;
  source: TicketSource;
  status: TicketStatus;
  priority: Priority;
  category: string;
  subject: string;
  message: string;
  userName?: string;
  ownerName?: string;
  userEmail?: string;
  ownerEmail?: string;
  userPhone?: string;
  ownerPhone?: string;
  turfName?: string;
  uid?: string;
  createdAt?: any;
  replies?: Reply[];
  resolvedAt?: any;
  adminNote?: string;
}

type FilterStatus = "all" | TicketStatus;
type FilterSource = "all" | TicketSource;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSenderName(t: Ticket) {
  return t.source === "owner" ? (t.ownerName || "Owner") : (t.userName || "User");
}
function getSenderEmail(t: Ticket) {
  return t.source === "owner" ? (t.ownerEmail || "") : (t.userEmail || "");
}
function getSenderPhone(t: Ticket) {
  return t.source === "owner" ? (t.ownerPhone || "") : (t.userPhone || "");
}
function formatDate(ts: any): string {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const STATUS_META: Record<TicketStatus, { label: string; color: string; bg: string; icon: string }> = {
  "open":        { label: "Open",        color: "#DC2626", bg: "#FEE2E2", icon: "alert-circle"        },
  "in-progress": { label: "In Progress", color: "#D97706", bg: "#FEF3C7", icon: "time"                },
  "resolved":    { label: "Resolved",    color: "#059669", bg: "#D1FAE5", icon: "checkmark-circle"    },
  "closed":      { label: "Closed",      color: "#6B7280", bg: "#F3F4F6", icon: "close-circle"        },
};

const SOURCE_META: Record<TicketSource, { label: string; color: string; bg: string }> = {
  "user":  { label: "User",  color: "#2563EB", bg: "#DBEAFE" },
  "owner": { label: "Owner", color: "#7C3AED", bg: "#EDE9FE" },
};

// ─── Ticket card (list) ───────────────────────────────────────────────────────
function TicketCard({ ticket, onPress }: { ticket: Ticket; onPress: () => void }) {
  const sm = STATUS_META[ticket.status] || STATUS_META.open;
  const src = SOURCE_META[ticket.source] || SOURCE_META.user;
  const replyCount = ticket.replies?.length || 0;

  return (
    <TouchableOpacity style={cs.card} onPress={onPress} activeOpacity={0.82}>
      {/* Priority stripe */}
      {ticket.priority === "high" && <View style={cs.priorityStripe} />}

      <View style={cs.cardTop}>
        {/* Source badge */}
        <View style={[cs.sourcePill, { backgroundColor: src.bg }]}>
          <Text style={[cs.sourceTxt, { color: src.color }]}>{src.label}</Text>
        </View>

        {/* Status badge */}
        <View style={[cs.statusPill, { backgroundColor: sm.bg }]}>
          <Ionicons name={sm.icon as any} size={10} color={sm.color} style={{ marginRight: 3 }} />
          <Text style={[cs.statusTxt, { color: sm.color }]}>{sm.label}</Text>
        </View>

        {/* High priority tag */}
        {ticket.priority === "high" && (
          <View style={cs.highPill}>
            <Ionicons name="flame" size={10} color="#DC2626" />
            <Text style={cs.highTxt}>High</Text>
          </View>
        )}
      </View>

      <Text style={cs.subject} numberOfLines={1}>{ticket.subject || ticket.category}</Text>
      <Text style={cs.senderRow}>
        <Text style={cs.senderName}>{getSenderName(ticket)}</Text>
        {ticket.turfName ? <Text style={cs.senderSub}>  ·  {ticket.turfName}</Text> : null}
      </Text>
      <Text style={cs.preview} numberOfLines={2}>{ticket.message}</Text>

      <View style={cs.cardFooter}>
        <Text style={cs.timeText}>{formatDate(ticket.createdAt)}</Text>
        {replyCount > 0 && (
          <View style={cs.replyCount}>
            <Ionicons name="chatbubble-outline" size={11} color="#6B7280" />
            <Text style={cs.replyCountTxt}>{replyCount}</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={14} color="#D1D5DB" />
      </View>
    </TouchableOpacity>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────
function TicketDetailModal({
  ticket,
  visible,
  onClose,
  onUpdated,
}: {
  ticket: Ticket | null;
  visible: boolean;
  onClose: () => void;
  onUpdated: (t: Ticket) => void;
}) {
  const [replyText, setReplyText]   = useState("");
  const [sending,   setSending]     = useState(false);
  const [updating,  setUpdating]    = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => { if (visible) setReplyText(""); }, [visible]);

  if (!ticket) return null;

  const sm  = STATUS_META[ticket.status]  || STATUS_META.open;
  const src = SOURCE_META[ticket.source]  || SOURCE_META.user;

  const sendReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      const newReply: Reply = {
        text: replyText.trim(),
        by:   "Admin",
        at:   new Date(),
      };
      const updatedReplies = [...(ticket.replies || []), newReply];
      await updateDoc(doc(db, "supportTickets", ticket.id), {
        replies:    updatedReplies,
        status:     ticket.status === "open" ? "in-progress" : ticket.status,
        updatedAt:  serverTimestamp(),
      });
      const updated: Ticket = {
        ...ticket,
        replies: updatedReplies,
        status:  ticket.status === "open" ? "in-progress" : ticket.status,
      };
      onUpdated(updated);
      setReplyText("");
    } catch {
      Alert.alert("Error", "Could not send reply.");
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (newStatus: TicketStatus) => {
    setUpdating(true);
    try {
      await updateDoc(doc(db, "supportTickets", ticket.id), {
        status:     newStatus,
        updatedAt:  serverTimestamp(),
        ...(newStatus === "resolved" ? { resolvedAt: serverTimestamp() } : {}),
      });
      onUpdated({ ...ticket, status: newStatus });
    } catch {
      Alert.alert("Error", "Could not update status.");
    } finally {
      setUpdating(false);
    }
  };

  const openEmail = () => {
    const email = getSenderEmail(ticket);
    if (!email) return;
    Linking.openURL(`mailto:${email}?subject=Re: ${ticket.subject || ticket.category}`);
  };

  const openPhone = () => {
    const phone = getSenderPhone(ticket);
    if (!phone) return;
    Linking.openURL(`tel:${phone}`);
  };

  const openWhatsapp = () => {
    const phone = getSenderPhone(ticket);
    if (!phone) return;
    const clean = phone.replace(/\D/g, "");
    Linking.openURL(`https://wa.me/91${clean}?text=Hi, this is Playon support regarding your ticket: "${ticket.subject || ticket.category}"`);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={ds.root}>
        <StatusBar barStyle="dark-content" />

        {/* Header */}
        <View style={ds.header}>
          <TouchableOpacity onPress={onClose} style={ds.backBtn}>
            <Ionicons name="close" size={22} color="#374151" />
          </TouchableOpacity>
          <Text style={ds.headerTitle} numberOfLines={1}>{ticket.subject || ticket.category}</Text>
          <View style={[ds.statusBadge, { backgroundColor: sm.bg }]}>
            <Text style={[ds.statusBadgeTxt, { color: sm.color }]}>{sm.label}</Text>
          </View>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={90}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={ds.scroll}
            showsVerticalScrollIndicator={false}
          >
            {/* Sender info */}
            <View style={ds.senderCard}>
              <View style={[ds.avatarCircle, { backgroundColor: src.bg }]}>
                <Ionicons
                  name={ticket.source === "owner" ? "business" : "person"}
                  size={20}
                  color={src.color}
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={ds.senderTopRow}>
                  <Text style={ds.senderName}>{getSenderName(ticket)}</Text>
                  <View style={[ds.srcPill, { backgroundColor: src.bg }]}>
                    <Text style={[ds.srcPillTxt, { color: src.color }]}>{src.label}</Text>
                  </View>
                  {ticket.priority === "high" && (
                    <View style={ds.highPill}>
                      <Ionicons name="flame" size={11} color="#DC2626" />
                      <Text style={ds.highPillTxt}>High priority</Text>
                    </View>
                  )}
                </View>
                {getSenderEmail(ticket) ? <Text style={ds.senderMeta}>{getSenderEmail(ticket)}</Text> : null}
                {getSenderPhone(ticket) ? <Text style={ds.senderMeta}>{getSenderPhone(ticket)}</Text> : null}
                {ticket.turfName        ? <Text style={ds.senderMeta}>Turf: {ticket.turfName}</Text>  : null}
                <Text style={ds.senderTime}>{formatDate(ticket.createdAt)}</Text>
              </View>
            </View>

            {/* Quick contact actions */}
            <View style={ds.contactRow}>
              {getSenderEmail(ticket) ? (
                <TouchableOpacity style={ds.contactBtn} onPress={openEmail}>
                  <Ionicons name="mail-outline" size={16} color="#2563EB" />
                  <Text style={[ds.contactBtnTxt, { color: "#2563EB" }]}>Email</Text>
                </TouchableOpacity>
              ) : null}
              {getSenderPhone(ticket) ? (
                <>
                  <TouchableOpacity style={ds.contactBtn} onPress={openPhone}>
                    <Ionicons name="call-outline" size={16} color="#059669" />
                    <Text style={[ds.contactBtnTxt, { color: "#059669" }]}>Call</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={ds.contactBtn} onPress={openWhatsapp}>
                    <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
                    <Text style={[ds.contactBtnTxt, { color: "#25D366" }]}>WhatsApp</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>

            {/* Category + subject */}
            <View style={ds.metaRow}>
              <View style={ds.metaChip}>
                <Text style={ds.metaChipTxt}>{ticket.category}</Text>
              </View>
            </View>

            {/* Original message */}
            <View style={ds.messageBox}>
              <Text style={ds.messageLabel}>Message</Text>
              <Text style={ds.messageText}>{ticket.message}</Text>
            </View>

            {/* Replies thread */}
            {(ticket.replies || []).length > 0 && (
              <View style={ds.threadSection}>
                <Text style={ds.threadTitle}>Conversation</Text>
                {(ticket.replies || []).map((r, i) => (
                  <View key={i} style={[ds.bubble, r.by === "Admin" ? ds.bubbleAdmin : ds.bubbleUser]}>
                    <View style={ds.bubbleHeader}>
                      <Text style={ds.bubbleBy}>{r.by}</Text>
                      <Text style={ds.bubbleTime}>{formatDate(r.at)}</Text>
                    </View>
                    <Text style={ds.bubbleText}>{r.text}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Status change */}
            <View style={ds.statusSection}>
              <Text style={ds.sectionLabel}>Change status</Text>
              <View style={ds.statusRow}>
                {(["open", "in-progress", "resolved", "closed"] as TicketStatus[]).map((s) => {
                  const m = STATUS_META[s];
                  const active = ticket.status === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[ds.statusBtn, active && { backgroundColor: m.bg, borderColor: m.color }]}
                      onPress={() => !active && changeStatus(s)}
                      disabled={updating || active}
                      activeOpacity={0.75}
                    >
                      <Ionicons name={m.icon as any} size={13} color={active ? m.color : "#9CA3AF"} />
                      <Text style={[ds.statusBtnTxt, active && { color: m.color }]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={{ height: 20 }} />
          </ScrollView>

          {/* Reply input */}
          {ticket.status !== "closed" && (
            <View style={ds.replyBar}>
              <TextInput
                style={ds.replyInput}
                placeholder="Type your reply..."
                placeholderTextColor="#9CA3AF"
                value={replyText}
                onChangeText={setReplyText}
                multiline
                maxLength={1000}
              />
              <TouchableOpacity
                style={[ds.sendBtn, (!replyText.trim() || sending) && ds.sendBtnDim]}
                onPress={sendReply}
                disabled={!replyText.trim() || sending}
              >
                {sending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="send" size={16} color="#fff" />
                }
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function AdminSupport() {
  const router = useRouter();

  const [tickets,     setTickets]     = useState<Ticket[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterSource, setFilterSource] = useState<FilterSource>("all");
  const [search,      setSearch]      = useState("");
  const [selected,    setSelected]    = useState<Ticket | null>(null);
  const [modalOpen,   setModalOpen]   = useState(false);

  useEffect(() => { fetchTickets(); }, []);

  const fetchTickets = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "supportTickets"), orderBy("createdAt", "desc"))
      );
      setTickets(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ticket)));
    } catch {
      Alert.alert("Error", "Could not load tickets.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const openTicket = (t: Ticket) => {
    setSelected(t);
    setModalOpen(true);
  };

  const onTicketUpdated = (updated: Ticket) => {
    setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
    setSelected(updated);
  };

  // ── Filter + search ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return tickets.filter(t => {
      if (filterStatus !== "all" && t.status !== filterStatus) return false;
      if (filterSource !== "all" && t.source !== filterSource) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const name  = getSenderName(t).toLowerCase();
        const subj  = (t.subject || "").toLowerCase();
        const cat   = (t.category || "").toLowerCase();
        const msg   = (t.message || "").toLowerCase();
        const email = getSenderEmail(t).toLowerCase();
        if (!name.includes(q) && !subj.includes(q) && !cat.includes(q) && !msg.includes(q) && !email.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, filterStatus, filterSource, search]);

  // ── Summary counts ───────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    open:       tickets.filter(t => t.status === "open").length,
    inProgress: tickets.filter(t => t.status === "in-progress").length,
    resolved:   tickets.filter(t => t.status === "resolved").length,
    high:       tickets.filter(t => t.priority === "high" && t.status === "open").length,
  }), [tickets]);

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color={ACCENT} />
      <Text style={s.loadText}>Loading tickets...</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* ── Hero header ── */}
      <View style={s.hero}>
        <View style={s.heroGlow} />
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={s.heroTag}>Admin · Support</Text>
        <Text style={s.heroTitle}>Support Inbox</Text>
        <Text style={s.heroSub}>Manage all user and owner tickets in one place.</Text>

        {/* Summary chips */}
        <View style={s.chipRow}>
          <View style={s.chip}>
            <Text style={s.chipNum}>{counts.open}</Text>
            <Text style={s.chipLbl}>Open</Text>
          </View>
          <View style={s.chip}>
            <Text style={s.chipNum}>{counts.inProgress}</Text>
            <Text style={s.chipLbl}>In Progress</Text>
          </View>
          <View style={s.chip}>
            <Text style={s.chipNum}>{counts.resolved}</Text>
            <Text style={s.chipLbl}>Resolved</Text>
          </View>
          {counts.high > 0 && (
            <View style={[s.chip, s.chipHigh]}>
              <Ionicons name="flame" size={12} color="#DC2626" />
              <Text style={[s.chipNum, { color: "#DC2626" }]}>{counts.high}</Text>
              <Text style={[s.chipLbl, { color: "#DC2626" }]}>High</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Search + filters ── */}
      <View style={s.controls}>
        {/* Search */}
        <View style={s.searchBar}>
          <Ionicons name="search-outline" size={16} color="#9CA3AF" />
          <TextInput
            style={s.searchInput}
            placeholder="Search tickets, names, emails..."
            placeholderTextColor="#9CA3AF"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>

        {/* Source filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          {(["all", "user", "owner"] as const).map(src => (
            <TouchableOpacity
              key={src}
              style={[s.filterChip, filterSource === src && s.filterChipOn]}
              onPress={() => setFilterSource(src)}
            >
              <Text style={[s.filterTxt, filterSource === src && s.filterTxtOn]}>
                {src === "all" ? "All Sources" : src === "user" ? "👤 Users" : "🏢 Owners"}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={s.filterDivider} />
          {(["all", "open", "in-progress", "resolved", "closed"] as const).map(st => (
            <TouchableOpacity
              key={st}
              style={[s.filterChip, filterStatus === st && s.filterChipOn]}
              onPress={() => setFilterStatus(st)}
            >
              <Text style={[s.filterTxt, filterStatus === st && s.filterTxtOn]}>
                {st === "all" ? "All Status" : STATUS_META[st as TicketStatus]?.label ?? st}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ── Ticket list ── */}
      <ScrollView
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchTickets(true)} tintColor={ACCENT} />}
      >
        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="chatbubbles-outline" size={48} color="#D1D5DB" />
            <Text style={s.emptyTitle}>No tickets found</Text>
            <Text style={s.emptySub}>
              {search ? "Try a different search term." : "All tickets matching your filters will appear here."}
            </Text>
          </View>
        ) : (
          <>
            <Text style={s.resultCount}>{filtered.length} ticket{filtered.length !== 1 ? "s" : ""}</Text>
            {/* High priority first */}
            {filtered
              .sort((a, b) => {
                if (a.priority === "high" && b.priority !== "high") return -1;
                if (b.priority === "high" && a.priority !== "high") return 1;
                return 0;
              })
              .map(t => (
                <TicketCard key={t.id} ticket={t} onPress={() => openTicket(t)} />
              ))
            }
          </>
        )}
        <View style={{ height: 120 }} />
      </ScrollView>

      <AdminNavBar />

      {/* ── Detail modal ── */}
      <TicketDetailModal
        ticket={selected}
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onUpdated={onTicketUpdated}
      />
    </SafeAreaView>
  );
}

// ─── Card styles ──────────────────────────────────────────────────────────────
const cs = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    overflow: "hidden",
  },
  priorityStripe: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: "#DC2626",
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  sourcePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  sourceTxt: { fontSize: 10, fontWeight: "700" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
  },
  statusTxt: { fontSize: 10, fontWeight: "700" },
  highPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
  },
  highTxt: { fontSize: 10, fontWeight: "700", color: "#DC2626" },
  subject:   { fontSize: 15, fontWeight: "700", color: "#111827", marginBottom: 2 },
  senderRow: { flexDirection: "row", marginBottom: 4 },
  senderName:{ fontSize: 12, fontWeight: "600", color: "#374151" },
  senderSub: { fontSize: 12, color: "#9CA3AF" },
  preview:   { fontSize: 13, color: "#6B7280", lineHeight: 18, marginBottom: 10 },
  cardFooter:{ flexDirection: "row", alignItems: "center", gap: 8 },
  timeText:  { fontSize: 11, color: "#9CA3AF", flex: 1 },
  replyCount:{ flexDirection: "row", alignItems: "center", gap: 3 },
  replyCountTxt: { fontSize: 11, color: "#6B7280" },
});

// ─── Detail modal styles ──────────────────────────────────────────────────────
const ds = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F9FAFB" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    backgroundColor: "#FFFFFF",
    gap: 10,
  },
  backBtn:    { padding: 4 },
  headerTitle:{ flex: 1, fontSize: 15, fontWeight: "700", color: "#111827" },
  statusBadge:{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusBadgeTxt: { fontSize: 11, fontWeight: "700" },
  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },

  senderCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  senderTopRow:{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 },
  senderName:  { fontSize: 15, fontWeight: "700", color: "#111827" },
  srcPill:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  srcPillTxt:  { fontSize: 10, fontWeight: "700" },
  highPill:    { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEE2E2", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  highPillTxt: { fontSize: 10, fontWeight: "700", color: "#DC2626" },
  senderMeta:  { fontSize: 12, color: "#6B7280", marginBottom: 1 },
  senderTime:  { fontSize: 11, color: "#9CA3AF", marginTop: 4 },

  contactRow:  { flexDirection: "row", gap: 8, marginBottom: 12 },
  contactBtn:  { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB" },
  contactBtnTxt:{ fontSize: 13, fontWeight: "600" },

  metaRow:     { flexDirection: "row", gap: 8, marginBottom: 12 },
  metaChip:    { backgroundColor: "#EDE9FE", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  metaChipTxt: { fontSize: 12, fontWeight: "600", color: "#7C3AED" },

  messageBox:  { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  messageLabel:{ fontSize: 11, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  messageText: { fontSize: 14, color: "#374151", lineHeight: 21 },

  threadSection:{ marginBottom: 16 },
  threadTitle:  { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 10 },
  bubble:       { borderRadius: 12, padding: 12, marginBottom: 8, maxWidth: "90%" },
  bubbleAdmin:  { backgroundColor: "#E0F2F1", alignSelf: "flex-end" },
  bubbleUser:   { backgroundColor: "#FFFFFF", alignSelf: "flex-start", borderWidth: 1, borderColor: "#F3F4F6" },
  bubbleHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  bubbleBy:     { fontSize: 11, fontWeight: "700", color: "#374151" },
  bubbleTime:   { fontSize: 11, color: "#9CA3AF" },
  bubbleText:   { fontSize: 13, color: "#374151", lineHeight: 19 },

  statusSection:{ marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 10 },
  statusRow:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusBtn:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#FFFFFF" },
  statusBtnTxt: { fontSize: 12, fontWeight: "600", color: "#6B7280" },

  replyBar:   { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  replyInput: { flex: 1, backgroundColor: "#F9FAFB", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: "#111827", maxHeight: 100, borderWidth: 1, borderColor: "#E5E7EB" },
  sendBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: ACCENT, justifyContent: "center", alignItems: "center" },
  sendBtnDim: { opacity: 0.4 },
});

// ─── Screen styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: BG },
  loadWrap:{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText:{ marginTop: 12, color: "#9CA3AF", fontSize: 14 },

  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? 48 : 16,
    paddingBottom: 20,
    position: "relative",
    overflow: "hidden",
  },
  heroGlow: {
    position: "absolute",
    top: -40,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: ACCENT,
    opacity: 0.12,
  },
  backBtn:  { marginBottom: 12 },
  heroTag:  { fontSize: 11, fontWeight: "700", color: ACCENT, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 },
  heroTitle:{ fontSize: 26, fontWeight: "800", color: "#FFFFFF", marginBottom: 4 },
  heroSub:  { fontSize: 13, color: "#94A3B8", marginBottom: 14 },

  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  chipHigh: { backgroundColor: "#FEE2E2" },
  chipNum:  { fontSize: 14, fontWeight: "800", color: "#FFFFFF" },
  chipLbl:  { fontSize: 11, color: "#94A3B8" },

  controls: { backgroundColor: "#FFFFFF", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    margin: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  searchInput:{ flex: 1, fontSize: 14, color: "#111827" },

  filterRow:   { paddingHorizontal: 12, paddingBottom: 4, gap: 6, flexDirection: "row" },
  filterChip:  { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F3F4F6" },
  filterChipOn:{ backgroundColor: ACCENT },
  filterTxt:   { fontSize: 12, fontWeight: "600", color: "#6B7280" },
  filterTxtOn: { color: "#FFFFFF" },
  filterDivider:{ width: 1, backgroundColor: "#E5E7EB", marginHorizontal: 4 },

  list:       { paddingHorizontal: 16, paddingTop: 12 },
  resultCount:{ fontSize: 12, color: "#9CA3AF", marginBottom: 8 },

  empty:      { alignItems: "center", paddingVertical: 60 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#374151", marginTop: 12 },
  emptySub:   { fontSize: 13, color: "#9CA3AF", marginTop: 4, textAlign: "center" },
});
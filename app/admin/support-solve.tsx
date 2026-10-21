import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet,  FlatList, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, StatusBar,
  Platform, Modal, KeyboardAvoidingView, Linking, ScrollView, Animated,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  collection, getDocs, doc, updateDoc,
  serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";
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

// ─── Types ────────────────────────────────────────────────────────────────────
type TicketStatus = "open" | "in-progress" | "resolved" | "closed";
type TicketSource = "user" | "owner";
type Priority     = "high" | "normal";

interface Reply   { text: string; by: string; at: any; }
interface Ticket  {
  id: string; source: TicketSource; status: TicketStatus; priority: Priority;
  category: string; subject: string; message: string;
  userName?: string; ownerName?: string; userEmail?: string; ownerEmail?: string;
  userPhone?: string; ownerPhone?: string; turfName?: string; uid?: string;
  createdAt?: any; replies?: Reply[]; resolvedAt?: any; adminNote?: string;
}

type FilterStatus = "all" | TicketStatus;
type FilterSource = "all" | TicketSource;

// ─── Config ───────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<TicketStatus, { label: string; color: string; bg: string; icon: string }> = {
  "open":        { label: "Open",        color: "#DC2626", bg: "#FEE2E2", icon: "alert-circle"     },
  "in-progress": { label: "In Progress", color: "#D97706", bg: "#FEF3C7", icon: "time"             },
  "resolved":    { label: "Resolved",    color: "#059669", bg: "#D1FAE5", icon: "checkmark-circle" },
  "closed":      { label: "Closed",      color: GRAY4,     bg: GRAY1,     icon: "close-circle"     },
};

const SOURCE_CFG: Record<TicketSource, { label: string; color: string; bg: string; icon: string }> = {
  "user":  { label: "User",  color: "#2563EB", bg: "#DBEAFE", icon: "person"   },
  "owner": { label: "Owner", color: "#7C3AED", bg: "#EDE9FE", icon: "business" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getSenderName  = (t: Ticket) => t.source === "owner" ? (t.ownerName  || "Owner") : (t.userName  || "User");
const getSenderEmail = (t: Ticket) => t.source === "owner" ? (t.ownerEmail || "")       : (t.userEmail || "");
const getSenderPhone = (t: Ticket) => t.source === "owner" ? (t.ownerPhone || "")       : (t.userPhone || "");

function fmtDate(ts: any): string {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)      return "just now";
  if (diff < 3600)    return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)   return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800)  return `${Math.floor(diff/86400)}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtFull(ts: any): string {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// ─── Quick reply templates ────────────────────────────────────────────────────
const QUICK_REPLIES = [
  "Thank you for reaching out. We're looking into your issue and will get back to you shortly.",
  "Your issue has been escalated to our technical team. We'll update you within 24 hours.",
  "We're happy to inform you that your issue has been resolved. Please let us know if you need further assistance.",
  "Could you please provide more details about the issue so we can assist you better?",
  "We apologize for the inconvenience. Our team is actively working on a fix.",
  "Your booking has been reviewed. Please check the app for updated details.",
];

// ─── Ticket Card ──────────────────────────────────────────────────────────────
const TicketCard = React.memo(function TicketCard({ ticket, onPress }: { ticket: Ticket; onPress: () => void }) {
  const sm  = STATUS_CFG[ticket.status]  ?? STATUS_CFG.open;
  const src = SOURCE_CFG[ticket.source]  ?? SOURCE_CFG.user;
  const replyCount = ticket.replies?.length ?? 0;
  const isHigh = ticket.priority === "high";

  return (
    <TouchableOpacity style={[cc.card, isHigh && cc.cardHigh]} onPress={onPress} activeOpacity={0.85}>
      {/* Left status bar */}
      <View style={[cc.bar, { backgroundColor: sm.color }]} />

      <View style={cc.inner}>
        {/* Top row */}
        <View style={cc.topRow}>
          <View style={[cc.srcPill, { backgroundColor: src.bg }]}>
            <Ionicons name={src.icon as any} size={10} color={src.color} />
            <Text style={[cc.srcTxt, { color: src.color }]}>{src.label}</Text>
          </View>
          <View style={[cc.stPill, { backgroundColor: sm.bg }]}>
            <Ionicons name={sm.icon as any} size={10} color={sm.color} />
            <Text style={[cc.stTxt, { color: sm.color }]}>{sm.label}</Text>
          </View>
          {isHigh && (
            <View style={cc.highPill}>
              <Ionicons name="flame" size={10} color="#DC2626" />
              <Text style={cc.highTxt}>Urgent</Text>
            </View>
          )}
          <Text style={cc.time}>{fmtDate(ticket.createdAt)}</Text>
        </View>

        {/* Subject */}
        <Text style={cc.subject} numberOfLines={1}>{ticket.subject || ticket.category}</Text>

        {/* Sender */}
        <View style={cc.senderRow}>
          <Ionicons name={src.icon as any} size={11} color={GRAY3} />
          <Text style={cc.senderName}>{getSenderName(ticket)}</Text>
          {!!ticket.turfName && <Text style={cc.senderSub}>· {ticket.turfName}</Text>}
        </View>

        {/* Preview */}
        <Text style={cc.preview} numberOfLines={2}>{ticket.message}</Text>

        {/* Footer */}
        <View style={cc.footer}>
          <View style={cc.categoryChip}>
            <Text style={cc.categoryTxt}>{ticket.category}</Text>
          </View>
          {replyCount > 0 && (
            <View style={cc.replyBadge}>
              <Ionicons name="chatbubble-outline" size={11} color={GRAY4} />
              <Text style={cc.replyCount}>{replyCount} repl{replyCount === 1 ? "y" : "ies"}</Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={14} color={GRAY2} style={{ marginLeft: "auto" as any }} />
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ─── Detail Modal ─────────────────────────────────────────────────────────────
function TicketDetailModal({ ticket, visible, onClose, onUpdated }: {
  
  ticket: Ticket | null; visible: boolean;
  onClose: () => void; onUpdated: (t: Ticket) => void;
}) {
    const insets = useSafeAreaInsets();
  const [replyText,    setReplyText]    = useState("");
  const [sending,      setSending]      = useState(false);
  const [updating,     setUpdating]     = useState(false);
  const [showQuick,    setShowQuick]    = useState(false);
  const [adminNote,    setAdminNote]    = useState("");
  const [savingNote,   setSavingNote]   = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible && ticket) {
      setReplyText("");
      setAdminNote(ticket.adminNote || "");
      setShowQuick(false);
    }
  }, [visible, ticket?.id]);

  if (!ticket) return null;

  const sm  = STATUS_CFG[ticket.status]  ?? STATUS_CFG.open;
  const src = SOURCE_CFG[ticket.source]  ?? SOURCE_CFG.user;

  const sendReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      const newReply: Reply = { text: replyText.trim(), by: "Admin", at: new Date() };
      const updatedReplies  = [...(ticket.replies || []), newReply];
      const newStatus: TicketStatus = ticket.status === "open" ? "in-progress" : ticket.status;
      await updateDoc(doc(db, "supportTickets", ticket.id), {
        replies: updatedReplies, status: newStatus, updatedAt: serverTimestamp(),
      });
      onUpdated({ ...ticket, replies: updatedReplies, status: newStatus });
      setReplyText("");
      setShowQuick(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    } catch { Alert.alert("Error", "Could not send reply."); }
    finally { setSending(false); }
  };

  const changeStatus = async (newStatus: TicketStatus) => {
    setUpdating(true);
    try {
      await updateDoc(doc(db, "supportTickets", ticket.id), {
        status: newStatus, updatedAt: serverTimestamp(),
        ...(newStatus === "resolved" ? { resolvedAt: serverTimestamp() } : {}),
      });
      onUpdated({ ...ticket, status: newStatus });
    } catch { Alert.alert("Error", "Could not update status."); }
    finally { setUpdating(false); }
  };

  const saveNote = async () => {
    setSavingNote(true);
    try {
      await updateDoc(doc(db, "supportTickets", ticket.id), { adminNote: adminNote.trim(), updatedAt: serverTimestamp() });
      onUpdated({ ...ticket, adminNote: adminNote.trim() });
      Alert.alert("Saved", "Admin note saved.");
    } catch { Alert.alert("Error", "Could not save note."); }
    finally { setSavingNote(false); }
  };

  const email = getSenderEmail(ticket);
  const phone = getSenderPhone(ticket);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={dm.root}>
        <StatusBar barStyle="dark-content" />

        {/* Header */}
        <View style={[dm.header, Platform.OS === "android" && { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={dm.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={18} color={GRAY5} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={dm.headerTitle} numberOfLines={1}>{ticket.subject || ticket.category}</Text>
            <Text style={dm.headerSub}>#{ticket.id.slice(0,10)}  ·  {fmtFull(ticket.createdAt)}</Text>
          </View>
          <View style={[dm.stBadge, { backgroundColor: sm.bg }]}>
            <Ionicons name={sm.icon as any} size={11} color={sm.color} />
            <Text style={[dm.stBadgeTxt, { color: sm.color }]}>{sm.label}</Text>
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
          <ScrollView ref={scrollRef} contentContainerStyle={dm.scroll} showsVerticalScrollIndicator={false}>

            {/* ── Sender card ── */}
            <View style={dm.card}>
              <View style={[dm.avatarCircle, { backgroundColor: src.bg }]}>
                <Ionicons name={src.icon as any} size={22} color={src.color} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={dm.senderTopRow}>
                  <Text style={dm.senderName}>{getSenderName(ticket)}</Text>
                  <View style={[dm.srcPill, { backgroundColor: src.bg }]}>
                    <Text style={[dm.srcPillTxt, { color: src.color }]}>{src.label}</Text>
                  </View>
                  {ticket.priority === "high" && (
                    <View style={dm.highPill}>
                      <Ionicons name="flame" size={10} color="#DC2626" />
                      <Text style={dm.highTxt}>Urgent</Text>
                    </View>
                  )}
                </View>
                {!!email && <Text style={dm.senderMeta}>{email}</Text>}
                {!!phone && <Text style={dm.senderMeta}>{phone}</Text>}
                {!!ticket.turfName && <Text style={dm.senderMeta}>Turf: {ticket.turfName}</Text>}
              </View>
            </View>

            {/* ── Contact buttons ── */}
            {(email || phone) && (
              <View style={dm.contactRow}>
                {!!email && (
                  <TouchableOpacity style={dm.contactBtn} onPress={() => Linking.openURL(`mailto:${email}?subject=Re: ${ticket.subject || ticket.category}`)}>
                    <Ionicons name="mail-outline" size={16} color="#2563EB" />
                    <Text style={[dm.contactLbl, { color: "#2563EB" }]}>Email</Text>
                  </TouchableOpacity>
                )}
                {!!phone && (
                  <>
                    <TouchableOpacity style={dm.contactBtn} onPress={() => Linking.openURL(`tel:${phone}`)}>
                      <Ionicons name="call-outline" size={16} color="#059669" />
                      <Text style={[dm.contactLbl, { color: "#059669" }]}>Call</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={dm.contactBtn} onPress={() => {
                      const c = phone.replace(/\D/g, "");
                      Linking.openURL(`https://wa.me/91${c}?text=Hi, this is Playon support regarding your ticket: "${ticket.subject || ticket.category}"`);
                    }}>
                      <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
                      <Text style={[dm.contactLbl, { color: "#25D366" }]}>WhatsApp</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {/* ── Category chip ── */}
            <View style={dm.metaRow}>
              <View style={dm.catChip}>
                <Ionicons name="pricetag-outline" size={11} color="#7C3AED" />
                <Text style={dm.catTxt}>{ticket.category}</Text>
              </View>
              {ticket.priority === "high" && (
                <View style={[dm.catChip, { backgroundColor: "#FEE2E2" }]}>
                  <Ionicons name="flame" size={11} color="#DC2626" />
                  <Text style={[dm.catTxt, { color: "#DC2626" }]}>High Priority</Text>
                </View>
              )}
            </View>

            {/* ── Original message ── */}
            <View style={dm.msgBox}>
              <Text style={dm.sectionLbl}>Original Message</Text>
              <Text style={dm.msgText}>{ticket.message}</Text>
            </View>

            {/* ── Conversation thread ── */}
            {(ticket.replies || []).length > 0 && (
              <View style={dm.threadWrap}>
                <Text style={dm.sectionLbl}>Conversation ({ticket.replies!.length})</Text>
                {ticket.replies!.map((r, i) => {
                  const isAdmin = r.by === "Admin";
                  return (
                    <View key={i} style={[dm.bubble, isAdmin ? dm.bubbleAdmin : dm.bubbleUser]}>
                      <View style={dm.bubbleHeader}>
                        <View style={[dm.bubbleAvatar, { backgroundColor: isAdmin ? GREEN_LT : GRAY1 }]}>
                          <Text style={[dm.bubbleAvatarTxt, { color: isAdmin ? GREEN : GRAY4 }]}>
                            {isAdmin ? "A" : getSenderName(ticket)[0]}
                          </Text>
                        </View>
                        <Text style={dm.bubbleBy}>{r.by}</Text>
                        <Text style={dm.bubbleTime}>{fmtDate(r.at)}</Text>
                      </View>
                      <Text style={dm.bubbleText}>{r.text}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* ── Status change ── */}
            <View style={dm.section}>
              <Text style={dm.sectionLbl}>Change Status</Text>
              <View style={dm.statusRow}>
                {(["open", "in-progress", "resolved", "closed"] as TicketStatus[]).map((s) => {
                  const m = STATUS_CFG[s];
                  const active = ticket.status === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[dm.stBtn, active && { backgroundColor: m.bg, borderColor: m.color }]}
                      onPress={() => !active && changeStatus(s)}
                      disabled={updating || active}
                      activeOpacity={0.75}
                    >
                      <Ionicons name={m.icon as any} size={13} color={active ? m.color : GRAY3} />
                      <Text style={[dm.stBtnTxt, active && { color: m.color, fontWeight: "700" }]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {updating && <ActivityIndicator size="small" color={GREEN} style={{ marginTop: 8 }} />}
            </View>

            {/* ── Admin internal note ── */}
            <View style={dm.section}>
              <Text style={dm.sectionLbl}>Internal Note (Admin only)</Text>
              <TextInput
                style={dm.noteInput}
                placeholder="Add a private note about this ticket..."
                placeholderTextColor={GRAY3}
                value={adminNote}
                onChangeText={setAdminNote}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[dm.saveNoteBtn, savingNote && { opacity: 0.6 }]}
                onPress={saveNote}
                disabled={savingNote}
              >
                {savingNote
                  ? <ActivityIndicator size="small" color={WHITE} />
                  : <Text style={dm.saveNoteTxt}>Save Note</Text>
                }
              </TouchableOpacity>
            </View>

            {/* ── Ticket info ── */}
            <View style={dm.section}>
              <Text style={dm.sectionLbl}>Ticket Info</Text>
              <View style={dm.infoBlock}>
                {[
                  { label: "Ticket ID",  value: `#${ticket.id.slice(0,14)}` },
                  { label: "Created",    value: fmtFull(ticket.createdAt) },
                  { label: "Source",     value: src.label },
                  { label: "Priority",   value: ticket.priority === "high" ? "High" : "Normal" },
                  { label: "Replies",    value: String(ticket.replies?.length ?? 0) },
                  ...(ticket.resolvedAt ? [{ label: "Resolved at", value: fmtFull(ticket.resolvedAt) }] : []),
                ].map((row, i) => (
                  <View key={i} style={[dm.infoRow, i > 0 && dm.infoRowBorder]}>
                    <Text style={dm.infoLabel}>{row.label}</Text>
                    <Text style={dm.infoValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>

          {/* ── Reply bar ── */}
          {ticket.status !== "closed" && (
            <View style={dm.replyWrap}>
              {/* Quick replies toggle */}
              <TouchableOpacity style={dm.quickToggle} onPress={() => setShowQuick(v => !v)}>
                <Ionicons name="flash" size={14} color={GREEN} />
                <Text style={dm.quickToggleTxt}>Quick replies</Text>
                <Ionicons name={showQuick ? "chevron-down" : "chevron-up"} size={13} color={GRAY3} />
              </TouchableOpacity>

              {/* Quick reply chips */}
              {showQuick && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={dm.quickRow}>
                  {QUICK_REPLIES.map((qr, i) => (
                    <TouchableOpacity key={i} style={dm.quickChip} onPress={() => { setReplyText(qr); setShowQuick(false); }}>
                      <Text style={dm.quickChipTxt} numberOfLines={2}>{qr}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {/* Input + send */}
              <View style={dm.replyBar}>
                <TextInput
                  style={dm.replyInput}
                  placeholder="Type your reply…"
                  placeholderTextColor={GRAY3}
                  value={replyText}
                  onChangeText={setReplyText}
                  multiline
                  maxLength={1000}
                />
                <TouchableOpacity
                  style={[dm.sendBtn, (!replyText.trim() || sending) && { opacity: 0.4 }]}
                  onPress={sendReply}
                  disabled={!replyText.trim() || sending}
                >
                  {sending
                    ? <ActivityIndicator size="small" color={WHITE} />
                    : <Ionicons name="send" size={16} color={WHITE} />
                  }
                </TouchableOpacity>
              </View>
            </View>
          )}

          {ticket.status === "closed" && (
            <View style={dm.closedBar}>
              <Ionicons name="lock-closed" size={14} color={GRAY3} />
              <Text style={dm.closedBarTxt}>This ticket is closed. Change status to reply.</Text>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminSupport() {
   const insets = useSafeAreaInsets(); 
  const [tickets,      setTickets]      = useState<Ticket[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterSource, setFilterSource] = useState<FilterSource>("all");
  const [search,       setSearch]       = useState("");
  const [selected,     setSelected]     = useState<Ticket | null>(null);
  const [modalOpen,    setModalOpen]    = useState(false);

  useEffect(() => { fetchTickets(); }, []);

  const fetchTickets = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "supportTickets"), orderBy("createdAt", "desc")));
      setTickets(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ticket)));
    } catch { Alert.alert("Error", "Could not load tickets."); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const openTicket    = useCallback((t: Ticket) => { setSelected(t); setModalOpen(true); }, []);
  const onTicketUpdated = useCallback((updated: Ticket) => {
    setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
    setSelected(updated);
  }, []);

  const filtered = useMemo(() => {
    let list = [...tickets];
    if (filterStatus !== "all") list = list.filter(t => t.status === filterStatus);
    if (filterSource !== "all") list = list.filter(t => t.source === filterSource);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        [getSenderName(t), t.subject, t.category, t.message, getSenderEmail(t), t.turfName]
          .some(f => f?.toLowerCase().includes(q))
      );
    }
    // High priority first, then by date
    return list.sort((a, b) => {
      if (a.priority === "high" && b.priority !== "high") return -1;
      if (b.priority === "high" && a.priority !== "high") return 1;
      return 0;
    });
  }, [tickets, filterStatus, filterSource, search]);

  const counts = useMemo(() => ({
    open:       tickets.filter(t => t.status === "open").length,
    inProgress: tickets.filter(t => t.status === "in-progress").length,
    resolved:   tickets.filter(t => t.status === "resolved").length,
    closed:     tickets.filter(t => t.status === "closed").length,
    high:       tickets.filter(t => t.priority === "high" && t.status === "open").length,
    total:      tickets.length,
  }), [tickets]);

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color={GREEN} />
      <Text style={s.loadTxt}>Loading tickets…</Text>
    </SafeAreaView>
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <FlatList
        data={filtered}
        keyExtractor={(t) => t.id}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchTickets(true)} tintColor={GREEN} />}
        renderItem={({ item }) => <TicketCard ticket={item} onPress={() => openTicket(item)} />}

        ListHeaderComponent={
          <View>
            {/* ── Dark header ── */}
          <View style={[s.header, { paddingTop: insets.top + 14 }]}>
              <View>
                <Text style={s.headerTag}>Admin · Support</Text>
                <Text style={s.headerTitle}>Support Inbox</Text>
              </View>
              {counts.high > 0 && (
                <View style={s.urgentBadge}>
                  <Ionicons name="flame" size={13} color="#DC2626" />
                  <Text style={s.urgentTxt}>{counts.high} urgent</Text>
                </View>
              )}
            </View>

            {/* ── Stats strip ── */}
            <View style={s.statsStrip}>
              {[
                { val: counts.total,      lbl: "Total",       color: WHITE     },
                { val: counts.open,       lbl: "Open",        color: "#F87171" },
                { val: counts.inProgress, lbl: "In Progress", color: "#FBBF24" },
                { val: counts.resolved,   lbl: "Resolved",    color: "#4ADE80" },
                { val: counts.closed,     lbl: "Closed",      color: "#94A3B8" },
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

            {/* ── Search ── */}
            <View style={s.searchDark}>
              <View style={s.searchWrap}>
                <Ionicons name="search-outline" size={16} color={GRAY3} />
                <TextInput
                  style={s.searchInput}
                  placeholder="Search tickets, names, emails, categories…"
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

            {/* ── Filter tabs ── */}
            <View style={s.filterWrap}>
              {/* Source filter */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
                {(["all", "user", "owner"] as const).map(src => {
                  const active = filterSource === src;
                  return (
                    <TouchableOpacity
                      key={src}
                      style={[s.filterChip, active && s.filterChipActive]}
                      onPress={() => setFilterSource(src)}
                    >
                      {src !== "all" && <Ionicons name={SOURCE_CFG[src].icon as any} size={11} color={active ? WHITE : GRAY4} />}
                      <Text style={[s.filterTxt, active && s.filterTxtActive]}>
                        {src === "all" ? "All" : SOURCE_CFG[src].label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                <View style={s.filterDivider} />

                {(["all", "open", "in-progress", "resolved", "closed"] as const).map(st => {
                  const active = filterStatus === st;
                  const meta   = st !== "all" ? STATUS_CFG[st as TicketStatus] : null;
                  return (
                    <TouchableOpacity
                      key={st}
                      style={[s.filterChip, active && { backgroundColor: meta?.color ?? DARK, borderColor: meta?.color ?? DARK }]}
                      onPress={() => setFilterStatus(st)}
                    >
                      {meta && <Ionicons name={meta.icon as any} size={11} color={active ? WHITE : meta.color} />}
                      <Text style={[s.filterTxt, active && s.filterTxtActive]}>
                        {st === "all" ? "All Status" : meta!.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* ── Result count ── */}
            <View style={s.resultRow}>
              <Text style={s.resultCount}>{filtered.length} ticket{filtered.length !== 1 ? "s" : ""}</Text>
              {counts.high > 0 && filterStatus === "all" && (
                <TouchableOpacity style={s.urgentFilter} onPress={() => setFilterStatus("open")}>
                  <Ionicons name="flame" size={11} color="#DC2626" />
                  <Text style={s.urgentFilterTxt}>Show urgent first ↑</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        }

        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="chatbubbles-outline" size={48} color={GRAY2} />
            <Text style={s.emptyTitle}>No tickets found</Text>
            <Text style={s.emptySub}>
              {search ? `No results for "${search}"` : "All matching tickets will appear here."}
            </Text>
          </View>
        }

        ListFooterComponent={<View style={{ height: 120 }} />}
      />

      <AdminNavBar />

      <TicketDetailModal
        ticket={selected}
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onUpdated={onTicketUpdated}
      />
    </View>
  );
}

// ─── Card styles ──────────────────────────────────────────────────────────────
const cc = StyleSheet.create({
  card: {
    flexDirection: "row", backgroundColor: WHITE,
    borderRadius: 16, marginBottom: 10, marginHorizontal: 16,
    borderWidth: 1, borderColor: GRAY2, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardHigh: { borderColor: "#FECACA" },
  bar:      { width: 4, flexShrink: 0 },
  inner:    { flex: 1, padding: 13 },
  topRow:   { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" },
  srcPill:  { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  srcTxt:   { fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  stPill:   { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  stTxt:    { fontSize: 9, fontWeight: "800" },
  highPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEE2E2", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  highTxt:  { fontSize: 9, fontWeight: "800", color: "#DC2626" },
  time:     { fontSize: 10, color: GRAY3, marginLeft: "auto" as any },
  subject:  { fontSize: 14, fontWeight: "800", color: DARK, marginBottom: 4 },
  senderRow:{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
  senderName:{ fontSize: 12, fontWeight: "600", color: GRAY5 },
  senderSub: { fontSize: 12, color: GRAY3 },
  preview:  { fontSize: 13, color: GRAY4, lineHeight: 18, marginBottom: 10 },
  footer:   { flexDirection: "row", alignItems: "center", gap: 8 },
  categoryChip: { backgroundColor: "#EDE9FE", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  categoryTxt:  { fontSize: 10, fontWeight: "700", color: "#7C3AED" },
  replyBadge:   { flexDirection: "row", alignItems: "center", gap: 3 },
  replyCount:   { fontSize: 10, color: GRAY4, fontWeight: "600" },
});

// ─── Detail modal styles ──────────────────────────────────────────────────────
const dm = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BODY_BG },
  header:  {  flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: GRAY2, backgroundColor: WHITE, gap: 10 },
  closeBtn:{ width: 32, height: 32, borderRadius: 9, backgroundColor: GRAY1, alignItems: "center", justifyContent: "center", marginTop: 2 },
  headerTitle: { fontSize: 15, fontWeight: "800", color: DARK, marginBottom: 2 },
  headerSub:   { fontSize: 10, color: GRAY3, fontWeight: "500" },
  stBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, marginTop: 2 },
  stBadgeTxt:  { fontSize: 10, fontWeight: "800" },
  scroll:  { paddingHorizontal: 16, paddingTop: 16 },

  card:    { flexDirection: "row", gap: 12, backgroundColor: WHITE, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: GRAY2 },
  avatarCircle: { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center", flexShrink: 0 },
  senderTopRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 },
  senderName:   { fontSize: 15, fontWeight: "800", color: DARK },
  srcPill:      { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  srcPillTxt:   { fontSize: 9, fontWeight: "800" },
  highPill:     { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEE2E2", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  highTxt:      { fontSize: 9, fontWeight: "800", color: "#DC2626" },
  senderMeta:   { fontSize: 12, color: GRAY4, marginBottom: 2 },

  contactRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  contactBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: WHITE, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: GRAY2 },
  contactLbl: { fontSize: 12, fontWeight: "700" },

  metaRow:  { flexDirection: "row", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  catChip:  { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#EDE9FE", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  catTxt:   { fontSize: 11, fontWeight: "700", color: "#7C3AED" },

  msgBox:    { backgroundColor: WHITE, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: GRAY2 },
  sectionLbl:{ fontSize: 11, fontWeight: "800", color: GRAY3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  msgText:   { fontSize: 14, color: GRAY5, lineHeight: 22 },

  threadWrap: { marginBottom: 14 },
  bubble:     { borderRadius: 14, padding: 12, marginBottom: 8, maxWidth: "92%" },
  bubbleAdmin:{ backgroundColor: GREEN_LT, alignSelf: "flex-end", borderWidth: 1, borderColor: GREEN + "33" },
  bubbleUser: { backgroundColor: WHITE,    alignSelf: "flex-start", borderWidth: 1, borderColor: GRAY2 },
  bubbleHeader:   { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  bubbleAvatar:   { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  bubbleAvatarTxt:{ fontSize: 11, fontWeight: "800" },
  bubbleBy:   { fontSize: 11, fontWeight: "700", color: GRAY5 },
  bubbleTime: { fontSize: 10, color: GRAY3, marginLeft: "auto" as any },
  bubbleText: { fontSize: 13, color: GRAY5, lineHeight: 20 },

  section:   { backgroundColor: WHITE, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: GRAY2 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stBtn:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: GRAY2, backgroundColor: WHITE },
  stBtnTxt:  { fontSize: 11, fontWeight: "600", color: GRAY4 },

  noteInput: { backgroundColor: GRAY1, borderRadius: 10, borderWidth: 1, borderColor: GRAY2, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: DARK, minHeight: 80, textAlignVertical: "top", marginBottom: 10 },
  saveNoteBtn: { backgroundColor: DARK, paddingVertical: 11, borderRadius: 11, alignItems: "center" },
  saveNoteTxt: { color: WHITE, fontWeight: "800", fontSize: 13 },

  infoBlock:    { borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: GRAY2 },
  infoRow:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, paddingHorizontal: 14, backgroundColor: WHITE },
  infoRowBorder:{ borderTopWidth: 1, borderTopColor: GRAY1 },
  infoLabel:    { fontSize: 12, color: GRAY3, fontWeight: "600" },
  infoValue:    { fontSize: 13, color: DARK, fontWeight: "700" },

  replyWrap:    { backgroundColor: WHITE, borderTopWidth: 1, borderTopColor: GRAY2, paddingBottom: Platform.OS === "ios" ? 4 : 0 },
  quickToggle:  { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: GRAY1 },
  quickToggleTxt:{ fontSize: 12, fontWeight: "700", color: GREEN, flex: 1 },
  quickRow:     { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  quickChip:    { backgroundColor: GREEN_LT, borderWidth: 1, borderColor: GREEN + "33", borderRadius: 10, padding: 10, maxWidth: 200 },
  quickChipTxt: { fontSize: 12, color: DARK, fontWeight: "500", lineHeight: 17 },
  replyBar:     { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12 },
  replyInput:   { flex: 1, backgroundColor: GRAY1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: DARK, maxHeight: 100, borderWidth: 1, borderColor: GRAY2 },
  sendBtn:      { width: 42, height: 42, borderRadius: 21, backgroundColor: GREEN, justifyContent: "center", alignItems: "center" },

  closedBar: {  flexDirection: "row", alignItems: "center", gap: 8, padding: 16, backgroundColor: GRAY1, borderTopWidth: 1, borderTopColor: GRAY2, justifyContent: "center" },
  closedBarTxt:{ fontSize: 13, color: GRAY3, fontWeight: "500",  },
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
    
    paddingBottom: 16,
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
  },
  headerTag:   { color: GREEN, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  headerTitle: { color: WHITE, fontSize: 26, fontWeight: "900", marginTop: 2, letterSpacing: -0.5 },
  urgentBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#FECACA", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, marginTop: 6 },
  urgentTxt:   { fontSize: 12, fontWeight: "700", color: "#DC2626" },

  statsStrip: { flexDirection: "row", alignItems: "center", backgroundColor: DARK, paddingHorizontal: 16, paddingBottom: 12 },
  stripItem:  { flex: 1, alignItems: "center" },
  stripVal:   { fontSize: 14, fontWeight: "900" },
  stripLbl:   { fontSize: 9, color: "#64748B", marginTop: 2, textAlign: "center" },
  stripDiv:   { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.08)" },

  searchDark: { backgroundColor: DARK, paddingHorizontal: 16, paddingBottom: 20, paddingTop: 14 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: WHITE, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: GRAY2, height: 46, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  searchInput:{ flex: 1, fontSize: 14, color: DARK, fontWeight: "500" },

  filterWrap: { backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: GRAY2 },
  filterRow:  { paddingHorizontal: 16, paddingVertical: 10, gap: 7 },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: GRAY1, borderWidth: 1, borderColor: GRAY2 },
  filterChipActive: { backgroundColor: DARK, borderColor: DARK },
  filterTxt:  { fontSize: 12, fontWeight: "700", color: GRAY4 },
  filterTxtActive:  { color: WHITE },
  filterDivider:    { width: 1, backgroundColor: GRAY2, marginHorizontal: 2 },

  resultRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  resultCount:{ fontSize: 11, color: GRAY3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  urgentFilter:    { flexDirection: "row", alignItems: "center", gap: 4 },
  urgentFilterTxt: { fontSize: 11, color: "#DC2626", fontWeight: "700" },

  empty:      { alignItems: "center", paddingVertical: 80, marginHorizontal: 16 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: DARK, marginTop: 14 },
  emptySub:   { fontSize: 13, color: GRAY3, marginTop: 6, textAlign: "center" },
});
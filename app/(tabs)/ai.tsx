import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Alert,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useRef, useState, useCallback } from "react";
import { auth } from "../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

// ─── Types ────────────────────────────────────────────────────────────────────
type TopicKey = "general" | "cricket" | "football" | "gym" | "nutrition";

interface CoachMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────
const TOPICS: { key: TopicKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "general",   label: "General",   icon: "chatbubble-outline" },
  { key: "cricket",   label: "Cricket",   icon: "baseball-outline" },
  { key: "football",  label: "Football",  icon: "football-outline" },
  { key: "gym",       label: "Gym",       icon: "barbell-outline" },
  { key: "nutrition", label: "Nutrition", icon: "nutrition-outline" },
];

const SUGGESTIONS: Record<TopicKey, string[]> = {
  general:   ["What should I focus on to improve fastest?", "How do I avoid burnout while training?"],
  cricket:   ["How does leg spin actually work?", "Drills to bowl a better yorker", "How do I read a spinner as a batter?"],
  football:  ["How do I improve my first touch?", "Best way to practice finishing", "How do I get faster off the mark?"],
  gym:       ["Build me a 3-day beginner workout split", "How much protein do I actually need?", "How do I fix my squat form?"],
  nutrition: ["What should I eat before a match?", "Simple pre-workout meal ideas", "How do I stay hydrated on match day?"],
};

let idCounter = 0;
function localId() { idCounter += 1; return `local_${Date.now()}_${idCounter}`; }

// ─── Message bubble ───────────────────────────────────────────────────────────
function Bubble({ message }: { message: CoachMessage }) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowCoach]}>
      {!isUser && (
        <View style={styles.coachAvatar}>
          <Text style={styles.coachAvatarText}>🤖</Text>
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleCoach]}>
        {message.pending ? (
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color="#9CA3AF" />
            <Text style={styles.typingText}>Coach is thinking…</Text>
          </View>
        ) : (
          <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>{message.content}</Text>
        )}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AiCoach() {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);

  const [topic, setTopic] = useState<TopicKey>("general");
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => { loadHistory(); }, []);

  const loadHistory = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) { setLoadingHistory(false); return; }
      const res = await fetch(`${SERVER_URL}/coach-history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessages(
          data.messages.map((m: any) => ({ id: m.id, role: m.role, content: m.content }))
        );
      }
    } catch {
      // silent — chat just starts empty, not worth blocking the screen
    } finally {
      setLoadingHistory(false);
    }
  };

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: CoachMessage = { id: localId(), role: "user", content: trimmed };
    const pendingMsg: CoachMessage = { id: localId(), role: "assistant", content: "", pending: true };

    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setInput("");
    setSending(true);
    scrollToEnd();

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(`${SERVER_URL}/coach-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: trimmed, topic }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Coach is unavailable right now.");

      setMessages((prev) =>
        prev.map((m) => (m.id === pendingMsg.id ? { ...m, content: data.reply, pending: false } : m))
      );
    } catch (e: any) {
      setMessages((prev) => prev.filter((m) => m.id !== pendingMsg.id));
      Alert.alert("Coach unavailable", e.message || "Something went wrong. Try again in a moment.");
    } finally {
      setSending(false);
      scrollToEnd();
    }
  }

  function startNewConversation() {
    Alert.alert(
      "Start New Conversation",
      "This clears your chat history with the coach. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            setMessages([]);
            try {
              const token = await auth.currentUser?.getIdToken();
              if (token) {
                await fetch(`${SERVER_URL}/coach-clear`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                });
              }
            } catch {}
          },
        },
      ]
    );
  }

  return (
    <View style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0F1E" />

      {/* ── HERO ─────────────────────────────────────────── */}
      <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
        <View style={styles.heroGlow1} />
        <View style={styles.heroGlow2} />
        <View style={styles.heroTopRow}>
          <View>
            <Text style={styles.heroTag}>AI Coach</Text>
            <Text style={styles.heroTitle}>Ask your coach</Text>
          </View>
          <TouchableOpacity style={styles.newChatBtn} onPress={startNewConversation}>
            <Ionicons name="refresh-outline" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={TOPICS}
          keyExtractor={(t) => t.key}
          contentContainerStyle={{ paddingTop: 12, paddingRight: 4 }}
          renderItem={({ item }) => {
            const active = topic === item.key;
            return (
              <TouchableOpacity
                style={[styles.topicChip, active && styles.topicChipActive]}
                onPress={() => setTopic(item.key)}
              >
                <Ionicons name={item.icon} size={13} color={active ? "#0A0F1E" : "#9CA3AF"} />
                <Text style={[styles.topicChipText, active && styles.topicChipTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {loadingHistory ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color="#0A0F1E" />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIconWrap}>
              <Text style={{ fontSize: 32 }}>🏆</Text>
            </View>
            <Text style={styles.emptyTitle}>What are we working on today?</Text>
            <Text style={styles.emptySub}>
              Ask about technique, training plans, or nutrition — I'll tailor it to your game.
            </Text>
            <View style={styles.suggestionWrap}>
              {SUGGESTIONS[topic].map((s) => (
                <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => sendMessage(s)}>
                  <Text style={styles.suggestionChipText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <Bubble message={item} />}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={scrollToEnd}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* ── INPUT BAR ─────────────────────────────────── */}
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={`Ask about ${topic === "general" ? "anything sports-related" : topic}…`}
            placeholderTextColor="#9CA3AF"
            style={styles.input}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || sending}
          >
            <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F4F8" },

  hero: {
    backgroundColor: "#0A0F1E",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
  },
  heroGlow1: { position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(34,197,94,0.15)" },
  heroGlow2: { position: "absolute", bottom: -60, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(96,165,250,0.10)" },
  heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroTag: { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 4 },
  newChatBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },

  topicChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginRight: 8,
    backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  topicChipActive: { backgroundColor: "#6EE7B7", borderColor: "#6EE7B7" },
  topicChipText: { color: "#9CA3AF", fontSize: 12, fontWeight: "700" },
  topicChipTextActive: { color: "#0A0F1E" },

  loaderWrap: { flex: 1, justifyContent: "center", alignItems: "center" },

  // ── Empty state ─────────────────────────────────────────
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  emptyIconWrap: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: "#F0FDF4",
    justifyContent: "center", alignItems: "center", marginBottom: 14,
    borderWidth: 1, borderColor: "#BBF7D0",
  },
  emptyTitle: { fontSize: 17, fontWeight: "900", color: "#111827", textAlign: "center" },
  emptySub: { fontSize: 13, color: "#9CA3AF", fontWeight: "600", textAlign: "center", marginTop: 6, lineHeight: 19 },
  suggestionWrap: { marginTop: 20, gap: 8, width: "100%" },
  suggestionChip: {
    backgroundColor: "#FFFFFF", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  suggestionChipText: { fontSize: 13, fontWeight: "700", color: "#374151" },

  // ── Chat list ────────────────────────────────────────────
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  bubbleRow: { flexDirection: "row", marginBottom: 14, alignItems: "flex-end", gap: 8 },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubbleRowCoach: { justifyContent: "flex-start" },

  coachAvatar: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: "#0A0F1E",
    justifyContent: "center", alignItems: "center",
  },
  coachAvatarText: { fontSize: 14 },

  bubble: { maxWidth: "78%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 11 },
  bubbleUser: { backgroundColor: "#0A0F1E", borderBottomRightRadius: 4 },
  bubbleCoach: { backgroundColor: "#FFFFFF", borderBottomLeftRadius: 4, borderWidth: 1, borderColor: "#E5E7EB" },
  bubbleText: { fontSize: 14, lineHeight: 21, color: "#111827", fontWeight: "500" },
  bubbleTextUser: { color: "#FFFFFF" },

  typingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  typingText: { fontSize: 12, color: "#9CA3AF", fontWeight: "600" },

  // ── Input bar ────────────────────────────────────────────
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 16, paddingTop: 10,
    backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: "#E5E7EB",
  },
  input: {
    flex: 1, backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB",
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 11,
    fontSize: 14, color: "#111827", maxHeight: 110,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: "#0A0F1E",
    justifyContent: "center", alignItems: "center",
  },
  sendBtnDisabled: { backgroundColor: "#D1D5DB" },
});
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  Image,
  Animated,
  Easing,
  Platform,
  StatusBar,
  Modal,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useState, useRef, useEffect } from "react";
import { auth } from "../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

// ── Design tokens ─────────────────────────────────────────────────────────────
const HEADER_BG = "#0B1220";
const BODY_BG   = "#F5F6FA";
const WHITE     = "#FFFFFF";
const GREEN     = "#4DB408";
const GREEN_LT  = "#EBF9E0";
const GREEN_MD  = "#D4F0BC";
const BRAND     = "#0B1220";
const GRAY1     = "#F3F4F6";
const GRAY2     = "#E5E7EB";
const GRAY3     = "#9CA3AF";
const GRAY4     = "#6B7280";
const GRAY5     = "#4B5563";

const ROLES = ["user", "owner", "turf-operator", "all"] as const;
type Role = (typeof ROLES)[number];

type SavedMessage = {
  id: string;
  label: string;
  title: string;
  body: string;
  createdAt: number;
};

const TEMPLATES = [
  { icon: "flash",            label: "Flash Sale",    color: "#D97706", bg: "#FEF3C7", title: "⚡ Flash Sale is LIVE!",         body: "Book your turf now and get exclusive discounts. Limited slots available!" },
  { icon: "checkmark-circle", label: "Booking",       color: "#059669", bg: "#D1FAE5", title: "🎉 Booking Confirmed!",           body: "Your booking has been confirmed. See you on the field!" },
  { icon: "alarm",            label: "Reminder",      color: "#6366F1", bg: "#EEF2FF", title: "⏰ Match Reminder",               body: "Your booking is tomorrow. Get ready to play!" },
  { icon: "megaphone",        label: "Announce",      color: "#EC4899", bg: "#FCE7F3", title: "📣 New Feature Available!",      body: "Check out our latest update and explore new features on Playon." },
  { icon: "sunny",            label: "Weekend",       color: "#F59E0B", bg: "#FEF3C7", title: "☀️ Tomorrow is Sunday!",         body: "Weekend slots are filling fast. Hurry up and book your turf now!" },
  { icon: "football",         label: "Match",         color: "#10B981", bg: "#D1FAE5", title: "⚽ Sunday Football Fever!",       body: "Gather your squad and lock your Sunday match before slots run out." },
  { icon: "time",             label: "Limited",       color: "#DC2626", bg: "#FEE2E2", title: "🔥 Only Few Slots Left!",         body: "Prime evening slots are almost sold out for tomorrow." },
  { icon: "pricetag",         label: "Offer",         color: "#7C3AED", bg: "#EDE9FE", title: "💸 Special Discount Today",      body: "Book now and enjoy exclusive discounted prices on selected turfs." },
  { icon: "gift",             label: "Reward",        color: "#EA580C", bg: "#FED7AA", title: "🎁 Surprise Reward Unlocked!",   body: "You've unlocked a special reward for your next booking." },
  { icon: "rainy",            label: "Rain Alert",    color: "#2563EB", bg: "#DBEAFE", title: "🌧 Rain Alert",                  body: "Weather looks rainy tomorrow. Indoor slots are getting booked quickly." },
  { icon: "partly-sunny",     label: "Nice Weather",  color: "#F59E0B", bg: "#FEF9C3", title: "🌤 Perfect Weather to Play!",    body: "Tomorrow's weather looks amazing for football. Book your slot now." },
  { icon: "flame",            label: "Trending",      color: "#EF4444", bg: "#FEE2E2", title: "🔥 Turf Trending Near You",      body: "Players are booking rapidly right now. Don't miss your preferred slot." },
  { icon: "people",           label: "Popular",       color: "#0891B2", bg: "#CFFAFE", title: "👥 Everyone's Booking Tonight",  body: "Peak evening slots are in high demand today." },
  { icon: "trophy",           label: "Loyalty",       color: "#CA8A04", bg: "#FEF08A", title: "🏆 Loyal Player Reward",         body: "Thanks for playing with Playon. Enjoy exclusive perks on your next booking." },
  { icon: "moon",             label: "Night Match",   color: "#4338CA", bg: "#E0E7FF", title: "🌙 Night Match Plans?",          body: "Cool weather and floodlights are waiting. Book your late-night game." },
  { icon: "sad",              label: "Miss You",      color: "#6B7280", bg: "#F3F4F6", title: "😢 We Miss You!",                body: "It's been a while since your last game. Time to get back on the turf!" },
  { icon: "reload",           label: "Comeback",      color: "#0EA5A4", bg: "#CCFBF1", title: "⚽ Ready for Your Next Match?",  body: "Your favorite turfs are waiting. Book again in seconds." },
];

const ROLE_CFG: Record<string, { icon: string; color: string; bg: string; border: string; label: string }> = {
  user:            { icon: "people",    color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE", label: "Users"     },
  owner:           { icon: "business",  color: "#059669", bg: "#ECFDF5", border: "#A7F3D0", label: "Owners"    },
  "turf-operator": { icon: "construct", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A", label: "Operators" },
  all:             { icon: "globe",     color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE", label: "Everyone"  },
};

// ── Send button ───────────────────────────────────────────────────────────────
function SendButton({ onPress, loading }: { onPress: () => void; loading: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1,    duration: 80, useNativeDriver: true }),
    ]).start();
    onPress();
  };
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity style={[s.sendBtn, loading && { opacity: 0.6 }]} onPress={handlePress} disabled={loading} activeOpacity={0.9}>
        {loading ? (
          <ActivityIndicator color={WHITE} size="small" />
        ) : (
          <View style={s.sendBtnInner}>
            <Ionicons name="send" size={18} color={WHITE} />
            <Text style={s.sendTxt}>Send Notification</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon, label, color, bg, border }: any) {
  return (
    <View style={[s.statCard, { backgroundColor: bg, borderColor: border }]}>
      <View style={[s.statIcon, { backgroundColor: WHITE }]}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <Text style={[s.statLabel, { color }]}>{label}</Text>
    </View>
  );
}

// ── Save message modal ────────────────────────────────────────────────────────
function SaveModal({
  visible,
  onClose,
  onSave,
  defaultTitle,
  defaultBody,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (label: string, title: string, body: string) => void;
  defaultTitle: string;
  defaultBody: string;
}) {
  const [label, setLabel] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [body,  setBody]  = useState(defaultBody);

  useEffect(() => {
    if (visible) {
      setLabel("");
      setTitle(defaultTitle);
      setBody(defaultBody);
    }
  }, [visible, defaultTitle, defaultBody]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <View style={s.modalBox}>
          {/* Header */}
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Save Custom Message</Text>
            <TouchableOpacity onPress={onClose} style={s.modalClose}>
              <Ionicons name="close" size={20} color={GRAY5} />
            </TouchableOpacity>
          </View>

          {/* Label */}
          <Text style={s.modalLabel}>Label *</Text>
          <TextInput
            style={s.modalInput}
            placeholder="e.g. My Weekend Promo"
            placeholderTextColor={GRAY3}
            value={label}
            onChangeText={setLabel}
            maxLength={40}
          />

          {/* Title */}
          <Text style={s.modalLabel}>Title *</Text>
          <TextInput
            style={s.modalInput}
            placeholder="Notification title"
            placeholderTextColor={GRAY3}
            value={title}
            onChangeText={setTitle}
            maxLength={100}
          />

          {/* Body */}
          <Text style={s.modalLabel}>Message *</Text>
          <TextInput
            style={[s.modalInput, { height: 90, textAlignVertical: "top" }]}
            placeholder="Notification body"
            placeholderTextColor={GRAY3}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={300}
          />

          {/* Actions */}
          <View style={s.modalActions}>
            <TouchableOpacity style={s.modalCancel} onPress={onClose}>
              <Text style={s.modalCancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.modalSave}
              onPress={() => {
                if (!label.trim() || !title.trim() || !body.trim()) {
                  Alert.alert("Required", "Please fill in all fields.");
                  return;
                }
                onSave(label.trim(), title.trim(), body.trim());
                onClose();
              }}
            >
              <Ionicons name="bookmark" size={14} color={WHITE} />
              <Text style={s.modalSaveTxt}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function AdminNotificationCenter() {
  const insets = useSafeAreaInsets();
 const [title,        setTitle]        = useState("");
  const [body,         setBody]         = useState("");
  const [imageUrl,     setImageUrl]     = useState("");
  const [role,         setRole]         = useState<Role>("user");
  const [loading,      setLoading]      = useState(false);
  const [sentCount,    setSentCount]    = useState<number | null>(null);
  const [charCount,    setCharCount]    = useState(0);
  const [history,      setHistory]      = useState<{ title: string; role: string; total: number; time: string }[]>([]);
  const [selectedTpl,  setSelectedTpl]  = useState<number | null>(null);
  const [savedMsgs,    setSavedMsgs]    = useState<SavedMessage[]>([]);
  const [showSaveModal,setShowSaveModal]= useState(false);

  const fadeAnim     = useRef(new Animated.Value(0)).current;
  const slideAnim    = useRef(new Animated.Value(24)).current;
  const successScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 450, easing: Easing.out(Easing.exp), useNativeDriver: true }),
    ]).start();
  }, []);

  const applyTemplate = (t: typeof TEMPLATES[0], idx: number) => {
    setTitle(t.title);
    setBody(t.body);
    setCharCount(t.body.length);
    setSelectedTpl(idx);
  };

  const applySaved = (m: SavedMessage) => {
    setTitle(m.title);
    setBody(m.body);
    setCharCount(m.body.length);
    setSelectedTpl(null); // deselect quick template
  };

  const saveMessage = (label: string, t: string, b: string) => {
    const newMsg: SavedMessage = {
      id:        Date.now().toString(),
      label,
      title:     t,
      body:      b,
      createdAt: Date.now(),
    };
    setSavedMsgs((prev) => [newMsg, ...prev]);
  };

  const deleteSaved = (id: string) => {
    Alert.alert("Delete", "Remove this saved message?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => setSavedMsgs((prev) => prev.filter((m) => m.id !== id)) },
    ]);
  };

  const showSuccess = (total: number) => {
    setSentCount(total);
    successScale.setValue(0);
    Animated.spring(successScale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
    setTimeout(() => setSentCount(null), 4000);
  };

  const sendNotification = async () => {
    if (!title.trim()) return Alert.alert("Required", "Please enter a title.");
    if (!body.trim())  return Alert.alert("Required", "Please enter a message.");
    const currentUser = auth.currentUser;
    if (!currentUser)  return Alert.alert("Not logged in", "Please log in again.");
    try {
      setLoading(true);
      const idToken = await currentUser.getIdToken(true);
      const payload: Record<string, any> = { title: title.trim(), body: body.trim() };
      if (role !== "all")  payload.role     = role;
      if (imageUrl.trim()) payload.imageUrl = imageUrl.trim();
      const response = await fetch(`${SERVER_URL}/send-admin-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (data.success) {
        const total = data.total ?? 0;
        showSuccess(total);
        setHistory((prev) => [
          { title: title.trim(), role, total, time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) },
          ...prev.slice(0, 4),
        ]);
        setTitle(""); setBody(""); setImageUrl(""); setCharCount(0); setSelectedTpl(null);
      } else {
        Alert.alert("Error", data.error || "Something went wrong.");
      }
    } catch (e: any) {
      Alert.alert("Network Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const cfg = ROLE_CFG[role];

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={HEADER_BG} />

      {/* ── Save modal ── */}
      <SaveModal
        visible={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSave={saveMessage}
        defaultTitle={title}
        defaultBody={body}
      />

      {/* ── Dark header ── */}
      <Animated.View style={[s.header, { paddingTop: insets.top + 16 }, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={s.headerIconWrap}>
          <Ionicons name="megaphone" size={20} color={GREEN} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Notification Center</Text>
          <Text style={s.headerSub}>Broadcast to your community</Text>
        </View>
      </Animated.View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Stats row ── */}
        <Animated.View style={[s.statsRow, { opacity: fadeAnim }]}>
          {(ROLES as readonly string[]).map((r) => {
            const c = ROLE_CFG[r];
            return <StatCard key={r} icon={c.icon} label={c.label} color={c.color} bg={c.bg} border={c.border} />;
          })}
        </Animated.View>

        {/* ── Success banner ── */}
        {sentCount !== null && (
          <Animated.View style={[s.successBanner, { transform: [{ scale: successScale }] }]}>
            <View style={s.successIcon}>
              <Ionicons name="checkmark-circle" size={20} color={GREEN} />
            </View>
            <Text style={s.successTxt}>
              Sent to <Text style={{ fontWeight: "900", color: GREEN }}>{sentCount}</Text> device{sentCount !== 1 ? "s" : ""} successfully!
            </Text>
          </Animated.View>
        )}

        {/* ── Quick templates ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.sectionDot} />
            <Text style={s.sectionTitle}>Quick Templates</Text>
            {selectedTpl !== null && (
              <View style={s.selectedBadge}>
                <Ionicons name="checkmark-circle" size={12} color={GREEN} />
                <Text style={s.selectedBadgeTxt}>Selected</Text>
              </View>
            )}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
            {TEMPLATES.map((t, i) => {
              const isSelected = selectedTpl === i;
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    s.templateChip,
                    { backgroundColor: isSelected ? t.color : t.bg, borderColor: t.color + (isSelected ? "FF" : "50") },
                  ]}
                  onPress={() => applyTemplate(t, i)}
                  activeOpacity={0.75}
                >
                  <Ionicons name={t.icon as any} size={13} color={isSelected ? WHITE : t.color} />
                  <Text style={[s.templateLabel, { color: isSelected ? WHITE : t.color }]}>{t.label}</Text>
                  {isSelected && <Ionicons name="checkmark" size={11} color={WHITE} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Saved messages ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.sectionDot} />
            <Text style={s.sectionTitle}>Saved Messages</Text>
            <TouchableOpacity
              style={s.saveNewBtn}
              onPress={() => {
                if (!title.trim() && !body.trim()) {
                  Alert.alert("Nothing to save", "Write a title and message first, then save it.");
                  return;
                }
                setShowSaveModal(true);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="bookmark-outline" size={13} color={GREEN} />
              <Text style={s.saveNewTxt}>Save current</Text>
            </TouchableOpacity>
          </View>

          {savedMsgs.length === 0 ? (
            <View style={s.savedEmpty}>
              <Ionicons name="bookmark-outline" size={24} color={GRAY3} />
              <Text style={s.savedEmptyTxt}>No saved messages yet.</Text>
              <Text style={s.savedEmptyHint}>Write a message and tap "Save current" to add one.</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
              {savedMsgs.map((m) => (
                <View key={m.id} style={s.savedChipWrap}>
                  <TouchableOpacity
                    style={s.savedChip}
                    onPress={() => applySaved(m)}
                    activeOpacity={0.8}
                  >
                    <View style={s.savedChipIcon}>
                      <Ionicons name="bookmark" size={12} color={GREEN} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.savedChipLabel} numberOfLines={1}>{m.label}</Text>
                      <Text style={s.savedChipTitle} numberOfLines={1}>{m.title}</Text>
                    </View>
                  </TouchableOpacity>
                  {/* Delete button */}
                  <TouchableOpacity style={s.savedDeleteBtn} onPress={() => deleteSaved(m.id)}>
                    <Ionicons name="close" size={12} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* ── Audience ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.sectionDot} />
            <Text style={s.sectionTitle}>Audience</Text>
          </View>
          <View style={s.rolesGrid}>
            {(ROLES as readonly string[]).map((r) => {
              const c = ROLE_CFG[r];
              const active = role === r;
              return (
                <TouchableOpacity
                  key={r}
                  style={[s.roleCard, active && { backgroundColor: c.bg, borderColor: c.color }]}
                  onPress={() => setRole(r as Role)}
                  activeOpacity={0.8}
                >
                  <View style={[s.roleIconWrap, { backgroundColor: active ? c.color : GRAY1 }]}>
                    <Ionicons name={c.icon as any} size={15} color={active ? WHITE : GRAY4} />
                  </View>
                  <Text style={[s.roleLabel, active && { color: c.color, fontWeight: "800" }]}>{c.label}</Text>
                  {active && (
                    <View style={[s.roleCheck, { backgroundColor: c.color }]}>
                      <Ionicons name="checkmark" size={9} color={WHITE} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Compose ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.sectionDot} />
            <Text style={s.sectionTitle}>Compose Message</Text>
          </View>

          {/* Title */}
          <View style={s.fieldWrap}>
            <View style={s.fieldHeader}>
              <Text style={s.fieldLabel}>Title *</Text>
              <Text style={s.fieldCount}>{title.length}/100</Text>
            </View>
            <View style={s.inputWrap}>
              <Ionicons name="text" size={15} color={GREEN} style={s.inputIcon} />
              <TextInput
                placeholder="e.g. ⚡ Flash Sale is LIVE!"
                placeholderTextColor={GRAY3}
                style={s.input}
                value={title}
                onChangeText={(t) => { setTitle(t); setSelectedTpl(null); }}
                maxLength={100}
              />
            </View>
          </View>

          {/* Body */}
          <View style={s.fieldWrap}>
            <View style={s.fieldHeader}>
              <Text style={s.fieldLabel}>Message *</Text>
              <Text style={[s.fieldCount, charCount > 250 && { color: "#EF4444" }]}>{charCount}/300</Text>
            </View>
            <View style={[s.inputWrap, { alignItems: "flex-start", paddingTop: 14 }]}>
              <Ionicons name="chatbubble-ellipses" size={15} color={GREEN} style={[s.inputIcon, { marginTop: 1 }]} />
              <TextInput
                placeholder="Write your notification message..."
                placeholderTextColor={GRAY3}
                multiline
                style={[s.input, { height: 100, textAlignVertical: "top" }]}
                value={body}
                onChangeText={(t) => { setBody(t); setCharCount(t.length); setSelectedTpl(null); }}
                maxLength={300}
              />
            </View>
          </View>

          {/* Image URL */}
          <View style={s.fieldWrap}>
            <View style={s.fieldHeader}>
              <Text style={s.fieldLabel}>Image URL <Text style={s.optional}>(optional)</Text></Text>
            </View>
            <View style={s.inputWrap}>
              <Ionicons name="image" size={15} color={GREEN} style={s.inputIcon} />
              <TextInput
                placeholder="https://your-image.com/img.jpg"
                placeholderTextColor={GRAY3}
                style={s.input}
                value={imageUrl}
                onChangeText={setImageUrl}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>
            {imageUrl.trim().length > 10 && (
              <Image source={{ uri: imageUrl.trim() }} style={s.imgPreview} resizeMode="cover" />
            )}
          </View>
        </View>

        {/* ── Live preview ── */}
        {(title || body) && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <View style={s.sectionDot} />
              <Text style={s.sectionTitle}>Live Preview</Text>
            </View>
            <View style={s.previewCard}>
              <View style={s.previewBar}>
                <Text style={s.previewBarTxt}>Android notification preview</Text>
                <View style={s.previewLive}>
                  <View style={s.previewLiveDot} />
                  <Text style={s.previewLiveTxt}>Live</Text>
                </View>
              </View>
              <View style={s.previewBody}>
                <View style={s.previewAppIcon}>
                  <Text style={s.previewAppIconTxt}>P</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.previewApp}>Playon  ·  <Text style={s.previewTime}>now</Text></Text>
                  <Text style={s.previewTitle} numberOfLines={1}>{title || "Notification title"}</Text>
                  <Text style={s.previewMsg}   numberOfLines={2}>{body  || "Notification message..."}</Text>
                </View>
                {imageUrl.trim().length > 10 && (
                  <Image source={{ uri: imageUrl.trim() }} style={s.previewThumb} />
                )}
              </View>
            </View>
          </View>
        )}

        {/* ── Send ── */}
        <View style={[s.section, { marginBottom: 32 }]}>
          <View style={[s.audienceBadge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
            <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
            <Text style={[s.audienceTxt, { color: cfg.color }]}>
              Sending to: <Text style={{ fontWeight: "900" }}>{cfg.label}</Text>
            </Text>
          </View>
          <SendButton onPress={sendNotification} loading={loading} />
        </View>

        {/* ── Recent history ── */}
        {history.length > 0 && (
          <View style={[s.section, { marginBottom: 40 }]}>
            <View style={s.sectionHeader}>
              <View style={s.sectionDot} />
              <Text style={s.sectionTitle}>Recent Sends</Text>
            </View>
            {history.map((h, i) => (
              <View key={i} style={s.historyItem}>
                <View style={s.historyIconWrap}>
                  <Ionicons name="checkmark-circle" size={18} color={GREEN} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.historyTitle} numberOfLines={1}>{h.title}</Text>
                  <Text style={s.historySub}>
                    {ROLE_CFG[h.role]?.label}  ·  {h.total} devices  ·  {h.time}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: BODY_BG },
  scroll:        { flex: 1 },
  scrollContent: { paddingBottom: 20 },

  // Header
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    backgroundColor:   HEADER_BG,
    paddingHorizontal: 20,
    
    paddingBottom:     18,
    gap: 14,
  },
  headerIconWrap: {
    width: 42, height: 42, borderRadius: 13,
    backgroundColor: GREEN + "20", borderWidth: 1, borderColor: GREEN + "40",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 19, fontWeight: "900", color: WHITE, letterSpacing: -0.3 },
  headerSub:   { fontSize: 12, color: "#FFFFFF66", marginTop: 1 },

  // Stats
  statsRow: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 14, gap: 8, marginBottom: 6 },
  statCard: { flex: 1, borderRadius: 12, padding: 10, alignItems: "center", gap: 5, borderWidth: 1 },
  statIcon: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", elevation: 1 },
  statLabel: { fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },

  // Success
  successBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: GREEN_LT, marginHorizontal: 16, marginBottom: 4,
    padding: 14, borderRadius: 14, borderWidth: 1, borderColor: GREEN_MD,
  },
  successIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: WHITE, alignItems: "center", justifyContent: "center" },
  successTxt:  { fontSize: 13, color: BRAND, fontWeight: "700", flex: 1 },

  // Section
  section:       { paddingHorizontal: 16, marginTop: 16 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionDot:    { width: 4, height: 16, borderRadius: 2, backgroundColor: GREEN },
  sectionTitle:  { fontSize: 14, fontWeight: "800", color: BRAND, letterSpacing: -0.1, flex: 1 },

  // Selected badge
  selectedBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: GREEN_LT, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1, borderColor: GREEN_MD,
  },
  selectedBadgeTxt: { fontSize: 10, fontWeight: "700", color: GREEN },

  // Templates
  templateChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
  },
  templateLabel: { fontSize: 11, fontWeight: "700" },

  // Saved messages
  saveNewBtn: {
    
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: GREEN_LT, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1, borderColor: GREEN_MD,
  },
  saveNewTxt: { fontSize: 11, fontWeight: "700", color: GREEN },

  savedEmpty: {
    alignItems: "center", paddingVertical: 20,
    backgroundColor: WHITE, borderRadius: 12,
    borderWidth: 1, borderColor: GRAY2, gap: 4,
  },
  savedEmptyTxt:  { fontSize: 13, color: GRAY4, fontWeight: "600", marginTop: 4 },
  savedEmptyHint: { fontSize: 11, color: GRAY3, textAlign: "center", paddingHorizontal: 20 },

  savedChipWrap: { position: "relative" },
  savedChip: {
    
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: WHITE, borderRadius: 12, padding: 10,
    borderWidth: 1, borderColor: GREEN + "44",
    minWidth: 140, maxWidth: 180,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  savedChipIcon: {
    
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: GREEN_LT, alignItems: "center", justifyContent: "center",
  },
  savedChipLabel: { fontSize: 11, fontWeight: "800", color: BRAND },
  savedChipTitle: { fontSize: 10, color: GRAY4, marginTop: 1 },
  savedDeleteBtn: {
    position: "absolute", top: 3, right: 8,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#FECACA",
    alignItems: "center", justifyContent: "center",
    zIndex: 10,
  },

  // Roles
  rolesGrid: { flexDirection: "row", gap: 8 },
  roleCard: {
    flex: 1, backgroundColor: WHITE, borderRadius: 12,
    padding: 10, alignItems: "center", gap: 5,
    borderWidth: 1.5, borderColor: GRAY2, position: "relative",
  },
  roleIconWrap: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  roleLabel:    { fontSize: 10, fontWeight: "600", color: GRAY4, textAlign: "center" },
  roleCheck: {
    position: "absolute", top: 5, right: 5,
    width: 15, height: 15, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },

  // Fields
  fieldWrap:   { marginBottom: 14 },
  fieldHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 7 },
  fieldLabel:  { fontSize: 11, fontWeight: "800", color: GRAY5, textTransform: "uppercase", letterSpacing: 0.5 },
  fieldCount:  { fontSize: 11, color: GRAY3, fontWeight: "600" },
  optional:    { color: GRAY3, fontWeight: "500", textTransform: "none", fontSize: 11 },
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: WHITE, borderRadius: 12,
    borderWidth: 1, borderColor: GRAY2, paddingHorizontal: 13,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  inputIcon: { marginRight: 9 },
  input:     { flex: 1, color: BRAND, fontSize: 14, paddingVertical: 13, fontWeight: "500" },
  imgPreview: { width: "100%", height: 130, borderRadius: 10, marginTop: 10, borderWidth: 1, borderColor: GRAY2 },

  // Preview
  previewCard: {
    backgroundColor: WHITE, borderRadius: 14,
    borderWidth: 1, borderColor: GRAY2, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  previewBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: GRAY1, paddingHorizontal: 12, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: GRAY2,
  },
  previewBarTxt:  { fontSize: 10, color: GRAY4, fontWeight: "600" },
  previewLive:    { flexDirection: "row", alignItems: "center", gap: 4 },
  previewLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN },
  previewLiveTxt: { fontSize: 10, color: GREEN, fontWeight: "700" },
  previewBody:    { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12 },
  previewAppIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  previewAppIconTxt: { color: WHITE, fontWeight: "900", fontSize: 15 },
  previewApp:   { fontSize: 10, color: GRAY3, fontWeight: "600", marginBottom: 2 },
  previewTime:  { color: GRAY3 },
  previewTitle: { fontSize: 13, fontWeight: "800", color: BRAND },
  previewMsg:   { fontSize: 11.5, color: GRAY4, marginTop: 1, lineHeight: 16 },
  previewThumb: { width: 46, height: 46, borderRadius: 8 },

  // Audience badge
  audienceBadge: {
    flexDirection: "row", alignItems: "center", gap: 7,
    alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, marginBottom: 12, borderWidth: 1,
  },
  audienceTxt: { fontSize: 12, fontWeight: "700" },

  // Send button
  sendBtn: {
    backgroundColor: GREEN, borderRadius: 14,
    paddingVertical: 16, alignItems: "center", justifyContent: "center",
    shadowColor: GREEN, shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 7,
  },
  sendBtnInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  sendTxt:      { color: WHITE, fontSize: 15, fontWeight: "900", letterSpacing: 0.3 },

  // History
  historyItem: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: WHITE, borderRadius: 12,
    padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: GRAY2, gap: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  historyIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: GREEN_LT, alignItems: "center", justifyContent: "center" },
  historyTitle:    { fontSize: 13, fontWeight: "700", color: BRAND, marginBottom: 2 },
  historySub:      { fontSize: 11, color: GRAY3, fontWeight: "500" },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: "#00000066",
    justifyContent: "flex-end",
  },
  modalBox: {
    backgroundColor: WHITE, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: Platform.OS === "android" ? 32 : 40,
  },
  modalHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 20,
  },
  modalTitle: { fontSize: 17, fontWeight: "900", color: BRAND },
  modalClose: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: GRAY1, alignItems: "center", justifyContent: "center",
  },
  modalLabel: { fontSize: 11, fontWeight: "800", color: GRAY5, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  modalInput: {
    backgroundColor: GRAY1, borderRadius: 10,
    borderWidth: 1, borderColor: GRAY2,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: BRAND, marginBottom: 14,
  },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  modalCancel: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    backgroundColor: GRAY1, borderWidth: 1, borderColor: GRAY2,
    alignItems: "center",marginBottom:25,
  },
  modalCancelTxt: { fontSize: 14, fontWeight: "700", color: GRAY5 },
  modalSave: {
    flex: 2, paddingVertical: 14, borderRadius: 12,
    backgroundColor: GREEN, alignItems: "center",
    flexDirection: "row", justifyContent: "center", gap: 8,
    shadowColor: GREEN, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
    marginBottom:25,
  },
  modalSaveTxt: { fontSize: 14, fontWeight: "900", color: WHITE },
});
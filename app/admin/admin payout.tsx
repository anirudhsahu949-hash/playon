import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  TextInput,
  RefreshControl,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useEffect, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  collection,
  getDocs,
  query,
  orderBy,
  getDoc,
  doc,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

// ── Types ──────────────────────────────────────────────────────────────────
type Settlement = {
  id: string;
  ownerId: string;
  ownerName: string;
  amount: number;
  method: "razorpay" | "manual";
  status: "processing" | "success" | "failed";
  createdAt: any;
  processedAt: any;
  turfId?: string;
  razorpayPayoutId?: string;
};

type OwnerSummary = {
  uid: string;
  name: string;
  email: string;
  phone: string;
  banking?: {
    accountNo: string;
    ifsc: string;
    name: string;
    verified: boolean;
  };
  totalPayable: number;
};

type PayoutSchedule = {
  payoutTime: string; // "17:00"
  enabled: boolean;
  timezone: string;
};

// ── Main Component ────────────────────────────────────────────────────────
export default function AdminPayoutManagement() {
  const insets = useSafeAreaInsets();
  const [owners, setOwners] = useState<OwnerSummary[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [schedule, setSchedule] = useState<PayoutSchedule | null>(null);

  // UI State
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [newPayoutTime, setNewPayoutTime] = useState("17:00");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState<OwnerSummary | null>(null);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutMethod, setPayoutMethod] = useState<"razorpay" | "manual">("razorpay");
  const [processingPayout, setProcessingPayout] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  // ── Fetch owners and settlements ────────────────────────────────────────
  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch settlement schedule
      const scheduleSnap = await getDoc(db.collection("appConfig").doc("payoutSchedule"));
      if (scheduleSnap.exists()) {
        setSchedule(scheduleSnap.data() as PayoutSchedule);
      }

      // Fetch all settlements
      const settlementsSnap = await getDocs(
        query(collection(db, "ownerSettlements"), orderBy("createdAt", "desc"))
      );

      const settlementsData: Settlement[] = [];
      settlementsSnap.forEach((doc) => {
        settlementsData.push(doc.data() as Settlement);
      });

      setSettlements(settlementsData);

      // Fetch owners with banking details
      const usersSnap = await getDocs(
        query(collection(db, "users"), ["role", "==", "owner"])
      );

      const ownersData: OwnerSummary[] = [];
      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        
        if (userData.banking?.verified) {
          // Calculate total payable (simplified - in real app, calculate from bookings)
          const ownerSettlements = settlementsData.filter(
            (s) => s.ownerId === userDoc.id && s.status === "success"
          );
          
          const totalPaid = ownerSettlements.reduce((sum, s) => sum + s.amount, 0);

          ownersData.push({
            uid: userDoc.id,
            name: userData.name,
            email: userData.email,
            phone: userData.phone,
            banking: userData.banking,
            totalPayable: totalPaid, // This should be calculated from actual bookings
          });
        }
      }

      setOwners(ownersData);
    } catch (err: any) {
      console.error("Fetch Error:", err);
      Alert.alert("Error", "Could not load payout data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ── Process Payout ────────────────────────────────────────────────────────
  const handleProcessPayout = async () => {
    if (!selectedOwner) return;

    setProcessingPayout(true);
    try {
      console.log(`Processing ${payoutMethod} payout for ${selectedOwner.name}`);

      const response = await fetch(`${SERVER_URL}/process-payout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId: selectedOwner.uid,
          amount: selectedOwner.totalPayable,
          method: payoutMethod,
          reason: "Daily settlement",
        }),
      });

      const result = await response.json();

      if (result.success) {
        Alert.alert(
          "✅ Payout Processed",
          `${selectedOwner.name} will receive ₹${selectedOwner.totalPayable} via ${payoutMethod}`
        );

        setShowPayoutModal(false);
        setSelectedOwner(null);
        
        // Refresh data
        fetchData();
      } else {
        Alert.alert("Error", result.error || "Failed to process payout");
      }
    } catch (err: any) {
      console.error("Payout Error:", err);
      Alert.alert("Error", err.message);
    } finally {
      setProcessingPayout(false);
    }
  };

  // ── Update Payout Schedule ────────────────────────────────────────────────
  const handleUpdateSchedule = async () => {
    setScheduleLoading(true);
    try {
      const response = await fetch(`${SERVER_URL}/update-payout-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payoutTime: newPayoutTime,
          enabled: true,
        }),
      });

      const result = await response.json();

      if (result.success) {
        Alert.alert(
          "✅ Schedule Updated",
          `Payouts scheduled for ${newPayoutTime} daily`
        );
        setSchedule({ payoutTime: newPayoutTime, enabled: true, timezone: "Asia/Kolkata" });
        setShowScheduleModal(false);
      } else {
        Alert.alert("Error", result.error || "Failed to update schedule");
      }
    } catch (err: any) {
      console.error("Schedule Error:", err);
      Alert.alert("Error", err.message);
    } finally {
      setScheduleLoading(false);
    }
  };

  // ── Loading State ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#0A0F1E" />
        <View style={s.center}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={s.loadText}>Loading payout data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const pendingOwners = owners.filter((o) => o.totalPayable > 0);
  const successfulPayouts = settlements.filter((s) => s.status === "success");
  const totalPaidOut = successfulPayouts.reduce((sum, s) => sum + s.amount, 0);

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0F1E" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchData();
            }}
            tintColor="#3B82F6"
          />
        }
      >
        {/* ── HEADER ── */}
         <View style={[s.header, { paddingTop: insets.top + 12 }]}>
          <View>
            <Text style={s.headerTitle}>Payout Management</Text>
            <Text style={s.headerSub}>Process owner settlements</Text>
          </View>
          <View style={s.headerIcon}>
            <Ionicons name="wallet-outline" size={32} color="#3B82F6" />
          </View>
        </View>

        {/* ── STATS ── */}
        <View style={s.statsContainer}>
          <View style={[s.statCard, s.statCardPending]}>
            <Ionicons name="timer-outline" size={20} color="#F59E0B" />
            <Text style={s.statNumber}>{pendingOwners.length}</Text>
            <Text style={s.statLabel}>Pending Payouts</Text>
          </View>

          <View style={[s.statCard, s.statCardSuccess]}>
            <Ionicons name="checkmark-circle-outline" size={20} color="#22C55E" />
            <Text style={s.statNumber}>
              ₹{(totalPaidOut / 100000).toFixed(1)}L
            </Text>
            <Text style={s.statLabel}>Total Paid</Text>
          </View>
        </View>

        {/* ── SCHEDULE CARD ── */}
        <View style={s.scheduleCard}>
          <View style={s.scheduleHeader}>
            <View>
              <Text style={s.scheduleTitle}>Automatic Payout Schedule</Text>
              <Text style={s.scheduleTime}>
                {schedule?.payoutTime || "Not set"} daily (Asia/Kolkata)
              </Text>
            </View>
            <TouchableOpacity
              style={s.scheduleBtn}
              onPress={() => {
                setNewPayoutTime(schedule?.payoutTime || "17:00");
                setShowScheduleModal(true);
              }}
            >
              <Ionicons name="create-outline" size={18} color="#fff" />
              <Text style={s.scheduleBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── TABS ── */}
        <View style={s.tabsContainer}>
          <TouchableOpacity
            style={[s.tab, activeTab === "pending" && s.tabActive]}
            onPress={() => setActiveTab("pending")}
          >
            <Text style={[s.tabText, activeTab === "pending" && s.tabTextActive]}>
              Pending ({pendingOwners.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.tab, activeTab === "history" && s.tabActive]}
            onPress={() => setActiveTab("history")}
          >
            <Text style={[s.tabText, activeTab === "history" && s.tabTextActive]}>
              History ({successfulPayouts.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── PENDING OWNERS ── */}
        {activeTab === "pending" ? (
          pendingOwners.length > 0 ? (
            <View style={s.listContainer}>
              {pendingOwners.map((owner) => (
                <TouchableOpacity
                  key={owner.uid}
                  style={s.ownerCard}
                  onPress={() => {
                    setSelectedOwner(owner);
                    setShowPayoutModal(true);
                  }}
                >
                  <View style={s.ownerLeft}>
                    <View style={s.avatar}>
                      <Ionicons name="person-circle" size={40} color="#3B82F6" />
                    </View>
                    <View style={s.ownerInfo}>
                      <Text style={s.ownerName}>{owner.name}</Text>
                      <Text style={s.ownerEmail}>{owner.email}</Text>
                      <Text style={s.ownerAmount}>
                        ₹{owner.totalPayable.toLocaleString("en-IN")}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={s.emptyState}>
              <Ionicons name="checkbox-outline" size={48} color="#D1D5DB" />
              <Text style={s.emptyTitle}>No Pending Payouts</Text>
              <Text style={s.emptySub}>All owners have received their settlements!</Text>
            </View>
          )
        ) : (
          /* ── HISTORY ── */
          successfulPayouts.length > 0 ? (
            <View style={s.listContainer}>
              {successfulPayouts.map((settlement) => (
                <View key={settlement.id} style={s.historyCard}>
                  <View style={s.historyLeft}>
                    <View style={[s.statusIcon, { backgroundColor: "#D1FAE5" }]}>
                      <Ionicons name="checkmark" size={16} color="#22C55E" />
                    </View>
                    <View style={s.historyInfo}>
                      <Text style={s.historyOwner}>{settlement.ownerName}</Text>
                      <Text style={s.historyMethod}>
                        {settlement.method === "razorpay" ? "🏦 Razorpay" : "💳 Manual"}
                      </Text>
                    </View>
                  </View>
                  <View style={s.historyRight}>
                    <Text style={s.historyAmount}>
                      ₹{settlement.amount.toLocaleString("en-IN")}
                    </Text>
                    <Text style={s.historyDate}>
                      {settlement.processedAt
                        ?.toDate?.()
                        .toLocaleDateString("en-IN")}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={s.emptyState}>
              <Ionicons name="document-text-outline" size={48} color="#D1D5DB" />
              <Text style={s.emptyTitle}>No History</Text>
              <Text style={s.emptySub}>Payout history will appear here</Text>
            </View>
          )
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ══ PAYOUT METHOD MODAL ════════════════════════════════ */}
      <Modal
        visible={showPayoutModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPayoutModal(false)}
      >
        <View style={m.backdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setShowPayoutModal(false)}
          />
          <View style={m.sheet}>
            <View style={m.handle} />

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={m.title}>Process Payout</Text>
              {selectedOwner && (
                <>
                  <View style={m.ownerBox}>
                    <Text style={m.boxLabel}>Owner</Text>
                    <Text style={m.boxValue}>{selectedOwner.name}</Text>
                  </View>

                  <View style={m.ownerBox}>
                    <Text style={m.boxLabel}>Amount</Text>
                    <Text style={m.amountValue}>
                      ₹{selectedOwner.totalPayable.toLocaleString("en-IN")}
                    </Text>
                  </View>

                  {/* Payment Method Selection */}
                  <Text style={m.label}>Payment Method</Text>

                  <TouchableOpacity
                    style={[
                      m.methodCard,
                      payoutMethod === "razorpay" && m.methodCardActive,
                    ]}
                    onPress={() => setPayoutMethod("razorpay")}
                  >
                    <Ionicons
                      name={payoutMethod === "razorpay" ? "radio-button-on" : "radio-button-off"}
                      size={20}
                      color={payoutMethod === "razorpay" ? "#3B82F6" : "#D1D5DB"}
                    />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={m.methodTitle}>Automatic (Razorpay)</Text>
                      <Text style={m.methodSub}>Instant transfer to bank account</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      m.methodCard,
                      payoutMethod === "manual" && m.methodCardActive,
                    ]}
                    onPress={() => setPayoutMethod("manual")}
                  >
                    <Ionicons
                      name={payoutMethod === "manual" ? "radio-button-on" : "radio-button-off"}
                      size={20}
                      color={payoutMethod === "manual" ? "#3B82F6" : "#D1D5DB"}
                    />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={m.methodTitle}>Manual</Text>
                      <Text style={m.methodSub}>You'll transfer manually later</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Action Buttons */}
                  <TouchableOpacity
                    style={[m.processBtn, processingPayout && { opacity: 0.6 }]}
                    onPress={handleProcessPayout}
                    disabled={processingPayout}
                  >
                    {processingPayout ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="send-outline" size={16} color="#fff" />
                        <Text style={m.processBtnText}>Process Payout</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={m.cancelBtn}
                    onPress={() => setShowPayoutModal(false)}
                    disabled={processingPayout}
                  >
                    <Text style={m.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ══ SCHEDULE MODAL ════════════════════════════════ */}
      <Modal
        visible={showScheduleModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowScheduleModal(false)}
      >
        <View style={m.backdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setShowScheduleModal(false)}
          />
          <View style={m.sheet}>
            <View style={m.handle} />

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={m.title}>Set Payout Time</Text>

              <View style={m.infoBox}>
                <Ionicons name="information-circle-outline" size={18} color="#3B82F6" />
                <Text style={m.infoText}>
                  Payouts will automatically process daily at this time (Asia/Kolkata)
                </Text>
              </View>

              <Text style={m.label}>Payout Time (HH:MM)</Text>
              <TextInput
                style={m.timeInput}
                placeholder="17:00"
                placeholderTextColor="#9CA3AF"
                value={newPayoutTime}
                onChangeText={setNewPayoutTime}
                editable={!scheduleLoading}
              />

              <Text style={m.hint}>
                Common times: 17:00 (5 PM), 18:00 (6 PM), 09:00 (9 AM)
              </Text>

              {/* Quick select buttons */}
              <View style={m.quickSelect}>
                {["09:00", "14:00", "17:00", "20:00"].map((time) => (
                  <TouchableOpacity
                    key={time}
                    style={[
                      m.quickBtn,
                      newPayoutTime === time && m.quickBtnActive,
                    ]}
                    onPress={() => setNewPayoutTime(time)}
                  >
                    <Text
                      style={[
                        m.quickBtnText,
                        newPayoutTime === time && m.quickBtnTextActive,
                      ]}
                    >
                      {time}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[m.saveBtn, scheduleLoading && { opacity: 0.6 }]}
                onPress={handleUpdateSchedule}
                disabled={scheduleLoading}
              >
                {scheduleLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="save-outline" size={16} color="#fff" />
                    <Text style={m.saveBtnText}>Save Schedule</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={m.cancelBtn}
                onPress={() => setShowScheduleModal(false)}
                disabled={scheduleLoading}
              >
                <Text style={m.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  scroll: { paddingBottom: 24 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadText: { marginTop: 12, fontSize: 14, color: "#64748B", fontWeight: "600" },

  header: {
    backgroundColor: "#0A0F1E",
    paddingHorizontal: 20,
    paddingVertical: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: { fontSize: 26, fontWeight: "900", color: "#fff" },
  headerSub: { fontSize: 12, color: "#94A3B8", marginTop: 4 },
  headerIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    justifyContent: "center",
    alignItems: "center",
  },

  statsContainer: { flexDirection: "row", gap: 12, paddingHorizontal: 16, marginVertical: 20 },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
  },
  statCardPending: { backgroundColor: "#FFFBEB", borderColor: "#FEF3C7" },
  statCardSuccess: { backgroundColor: "#F0FDF4", borderColor: "#DCFCE7" },
  statNumber: { fontSize: 20, fontWeight: "900", color: "#0F172A", marginTop: 8 },
  statLabel: { fontSize: 11, color: "#64748B", marginTop: 4, fontWeight: "700" },

  scheduleCard: {
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 20,
  },
  scheduleHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  scheduleTitle: { fontSize: 14, fontWeight: "800", color: "#0A0F1E" },
  scheduleTime: { fontSize: 12, color: "#3B82F6", marginTop: 4, fontWeight: "700" },
  scheduleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#3B82F6",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  scheduleBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  tabsContainer: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: "#E2E8F0", alignItems: "center" },
  tabActive: { backgroundColor: "#3B82F6" },
  tabText: { fontSize: 12, fontWeight: "700", color: "#64748B" },
  tabTextActive: { color: "#fff" },

  listContainer: { paddingHorizontal: 16 },
  ownerCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  ownerLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  avatar: { marginRight: 12 },
  ownerInfo: { flex: 1 },
  ownerName: { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  ownerEmail: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  ownerAmount: { fontSize: 13, fontWeight: "900", color: "#22C55E", marginTop: 4 },

  historyCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  historyLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  statusIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: "center", alignItems: "center" },
  historyInfo: { marginLeft: 12, flex: 1 },
  historyOwner: { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  historyMethod: { fontSize: 11, color: "#64748B", marginTop: 2, fontWeight: "600" },
  historyRight: { alignItems: "flex-end" },
  historyAmount: { fontSize: 13, fontWeight: "900", color: "#0F172A" },
  historyDate: { fontSize: 10, color: "#9CA3AF", marginTop: 2 },

  emptyState: { alignItems: "center", paddingVertical: 60 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#0F172A", marginTop: 12 },
  emptySub: { fontSize: 13, color: "#64748B", marginTop: 4, textAlign: "center", paddingHorizontal: 16 },
});

// ── Modal Styles ──────────────────────────────────────────────────────────
const m = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "90%",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E2E8F0",
    alignSelf: "center",
    marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: "900", color: "#0F172A", marginBottom: 20 },
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 8,
  },

  ownerBox: {
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  boxLabel: { fontSize: 11, color: "#9CA3AF", fontWeight: "700" },
  boxValue: { fontSize: 16, fontWeight: "900", color: "#0F172A", marginTop: 4 },
  amountValue: { fontSize: 24, fontWeight: "900", color: "#22C55E", marginTop: 4 },

  methodCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  methodCardActive: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
  methodTitle: { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  methodSub: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },

  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#3B82F6",
  },
  infoText: { flex: 1, fontSize: 12, color: "#1E40AF", fontWeight: "600", lineHeight: 18 },

  timeInput: {
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  hint: { fontSize: 11, color: "#9CA3AF", marginBottom: 16, textAlign: "center", fontWeight: "500" },

  quickSelect: { flexDirection: "row", gap: 8, marginBottom: 20 },
  quickBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
  },
  quickBtnActive: { backgroundColor: "#3B82F6" },
  quickBtnText: { fontSize: 12, fontWeight: "700", color: "#374151" },
  quickBtnTextActive: { color: "#fff" },

  processBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#22C55E",
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  processBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#3B82F6",
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  cancelBtn: {
    backgroundColor: "#F3F4F6",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelBtnText: { color: "#374151", fontWeight: "700", fontSize: 15 },
});
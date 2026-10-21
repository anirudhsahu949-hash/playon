import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Modal,
  TextInput,
  RefreshControl,
} from "react-native";
import { useEffect, useState } from "react";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, db } from "../../firebaseConfig";
import {
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  doc,
  orderBy,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

// ── Types ──────────────────────────────────────────────────────────────────
type OwnerBankData = {
  uid: string;
  name: string;
  email: string;
  phone: string;
  businessName: string;
  banking: {
    accountNo: string;
    ifsc: string;
    name: string;
    upi?: string;
    verified: boolean;
    updatedAt: any;
    rejectionReason?: string;
    rejectedAt?: any;
    verifiedAt?: any;
  };
  createdAt: any;
};

type TabType = "pending" | "approved" | "rejected";

// ── Main ──────────────────────────────────────────────────────────────────
export default function AdminBankVerification() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>("pending");
  const [owners, setOwners] = useState<OwnerBankData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Detail modal
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState<OwnerBankData | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Reject modal
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Search
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    fetchAllOwners();
  }, []);

  // ── Fetch all owners with banking details ────────────────────────────────
  const fetchAllOwners = async () => {
    setLoading(true);
    try {
      // Get all users with role "owner" (simple query)
      const ownersSnap = await getDocs(
        query(
          collection(db, "users"),
          where("role", "==", "owner")
        )
      );

      const ownersData: OwnerBankData[] = [];
      
      // Filter for owners who have banking details (in JavaScript)
      ownersSnap.forEach((doc) => {
        const data = doc.data();
        
        // Only include if banking object exists and has required fields
        if (data.banking && data.banking.accountNo && data.banking.ifsc) {
          ownersData.push({
            uid: doc.id,
            name: data.name || "Unknown",
            email: data.email || "",
            phone: data.phone || "",
            businessName: data.businessName || "",
            banking: {
              accountNo: data.banking.accountNo || "",
              ifsc: data.banking.ifsc || "",
              name: data.banking.name || "",
              upi: data.banking.upi || null,
              verified: data.banking.verified || false,
              updatedAt: data.banking.updatedAt || new Date(),
            },
            createdAt: data.createdAt,
          } as OwnerBankData);
        }
      });

      // Sort by updatedAt (newest first)
      ownersData.sort((a, b) => {
        const dateA = a.banking.updatedAt?.toDate?.() || new Date(0);
        const dateB = b.banking.updatedAt?.toDate?.() || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });

      setOwners(ownersData);
      
      if (ownersData.length === 0) {
        console.log("No owners with banking details found");
      }
    } catch (err: any) {
      console.error("Fetch Error:", err.message || err);
      Alert.alert(
        "Error Loading Data",
        err.message || "Could not load owners. Check console for details."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ── Filter owners by tab ────────────────────────────────────────────────
  const getFilteredOwners = () => {
    let filtered = owners.filter((owner) => {
      const searchLower = searchText.toLowerCase();
      return (
        owner.name.toLowerCase().includes(searchLower) ||
        owner.email.toLowerCase().includes(searchLower) ||
        owner.businessName.toLowerCase().includes(searchLower)
      );
    });

    if (activeTab === "pending") {
      // Show owners who are not verified AND don't have rejection reason
      return filtered.filter((o) => !o.banking.verified && !o.banking.rejectionReason);
    } else if (activeTab === "approved") {
      // Show owners who are verified
      return filtered.filter((o) => o.banking.verified);
    } else {
      // Show owners who are rejected (have rejection reason)
      return filtered.filter((o) => o.banking.rejectionReason);
    }
  };

  // ── Approve Bank Details ────────────────────────────────────────────────
  const handleApprove = async (owner: OwnerBankData) => {
    setActionLoading(true);
    try {
      await updateDoc(doc(db, "users", owner.uid), {
        banking: {
          ...owner.banking,
          verified: true,
          verifiedAt: new Date(),
        },
      });

      // Update local state
      setOwners((prev) =>
        prev.map((o) =>
          o.uid === owner.uid
            ? {
                ...o,
                banking: {
                  ...o.banking,
                  verified: true,
                  verifiedAt: new Date(),
                },
              }
            : o
        )
      );

      Alert.alert(
        "✅ Approved",
        `${owner.name}'s bank details have been verified.\n\nThey can now receive settlements.`
      );

      setShowDetailModal(false);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not approve");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Reject Bank Details ────────────────────────────────────────────────
  const handleReject = async () => {
    if (!selectedOwner) {
      console.error("❌ No owner selected");
      Alert.alert("Error", "No owner selected for rejection");
      return;
    }
    
    setActionLoading(true);
    console.log("🔄 Starting rejection for owner:", selectedOwner.uid);
    console.log("📊 Selected owner data:", selectedOwner);
    
    try {
      const reason = rejectReason.trim() || "Please check your bank details and resubmit.";
      console.log("📝 Reason:", reason);

      // Construct new banking object
      const updatedBanking = {
        accountNo: selectedOwner.banking.accountNo,
        ifsc: selectedOwner.banking.ifsc,
        name: selectedOwner.banking.name,
        upi: selectedOwner.banking.upi || null,
        verified: false,
        updatedAt: new Date(),  // ← IMPORTANT: Set fresh date
        rejectionReason: reason,
        rejectedAt: new Date(),
      };

      console.log("💾 Banking object to save:", JSON.stringify(updatedBanking, null, 2));

      const userDocRef = doc(db, "users", selectedOwner.uid);
      console.log("📄 Doc ref path:", userDocRef.path);

      // Update Firestore
      await updateDoc(userDocRef, {
        banking: updatedBanking,
      });

      console.log("✅ Firestore update successful");

      // Update local state
      const newOwners = owners.map((o) =>
        o.uid === selectedOwner.uid
          ? {
              ...o,
              banking: {
                ...o.banking,
                verified: false,
                rejectionReason: reason,
                rejectedAt: new Date(),
              },
            }
          : o
      );
      setOwners(newOwners);
      console.log("✅ Local state updated, total owners:", newOwners.length);

      // Reset form
      setRejectReason("");
      console.log("✅ Form reset");

      // Close modals
      setShowRejectModal(false);
      setShowDetailModal(false);
      setSelectedOwner(null);
      console.log("✅ Modals closed");
      
      // Show success
      Alert.alert(
        "✅ Rejection Saved",
        `${selectedOwner.name} has been rejected.\n\nReason: "${reason}"`
      );
      
    } catch (err: any) {
      console.error("❌ ERROR during rejection:", {
        code: err.code,
        message: err.message,
        stack: err.stack,
      });
      
      Alert.alert(
        "❌ Rejection Failed",
        `Error: ${err.message}\n\nMake sure you have admin permissions.`
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ── Open Detail Modal ──────────────────────────────────────────────────
  const openDetails = (owner: OwnerBankData) => {
    setSelectedOwner(owner);
    setShowDetailModal(true);
  };

  const filteredOwners = getFilteredOwners();
  const stats = {
    pending: owners.filter((o) => !o.banking.verified && !o.banking.rejectionReason).length,
    approved: owners.filter((o) => o.banking.verified).length,
    rejected: owners.filter((o) => o.banking.rejectionReason).length,
    total: owners.length,
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#0A0F1E" />
        <View style={s.center}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={s.loadText}>Loading banking data...</Text>
        </View>
      </SafeAreaView>
    );
  }

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
              fetchAllOwners();
            }}
            tintColor="#3B82F6"
          />
        }
      >
        {/* ── HEADER ── */}
         <View style={[s.header, { paddingTop: insets.top + 12 }]}>
          <View>
            <Text style={s.headerTitle}>Banking System</Text>
            <Text style={s.headerSub}>Manage owner bank verification</Text>
          </View>
          <View style={s.headerIcon}>
            <Ionicons name="card-outline" size={32} color="#3B82F6" />
          </View>
        </View>

        {/* ── STATISTICS ── */}
        <View style={s.statsContainer}>
          <View style={[s.statCard, s.statCardPending]}>
            <View style={s.statIconBox}>
              <Ionicons name="hourglass-outline" size={24} color="#F59E0B" />
            </View>
            <Text style={s.statNumber}>{stats.pending}</Text>
            <Text style={s.statLabel}>Pending</Text>
          </View>

          <View style={[s.statCard, s.statCardApproved]}>
            <View style={s.statIconBox}>
              <Ionicons name="checkmark-circle-outline" size={24} color="#22C55E" />
            </View>
            <Text style={s.statNumber}>{stats.approved}</Text>
            <Text style={s.statLabel}>Approved</Text>
          </View>

          <View style={[s.statCard, s.statCardTotal]}>
            <View style={s.statIconBox}>
              <Ionicons name="folder-outline" size={24} color="#3B82F6" />
            </View>
            <Text style={s.statNumber}>{stats.total}</Text>
            <Text style={s.statLabel}>Total</Text>
          </View>
        </View>

        {/* ── SEARCH ── */}
        <View style={s.searchContainer}>
          <Ionicons name="search-outline" size={18} color="#9CA3AF" />
          <TextInput
            style={s.searchInput}
            placeholder="Search owner name, email, business..."
            placeholderTextColor="#9CA3AF"
            value={searchText}
            onChangeText={setSearchText}
          />
          {searchText ? (
            <TouchableOpacity onPress={() => setSearchText("")}>
              <Ionicons name="close-circle" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── TABS ── */}
        <View style={s.tabsContainer}>
          {(["pending", "approved", "rejected"] as TabType[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[s.tab, activeTab === tab && s.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text
                style={[
                  s.tabText,
                  activeTab === tab && s.tabTextActive,
                ]}
              >
                {tab === "pending"
                  ? `Pending (${stats.pending})`
                  : tab === "approved"
                  ? `Approved (${stats.approved})`
                  : `Rejected (${stats.rejected})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── OWNERS LIST ── */}
        {filteredOwners.length === 0 ? (
          <View style={s.emptyState}>
            <Ionicons name="inbox-outline" size={48} color="#D1D5DB" />
            <Text style={s.emptyStateTitle}>
              {activeTab === "pending"
                ? "No pending verifications"
                : "No approved owners"}
            </Text>
            <Text style={s.emptyStateSub}>
              {activeTab === "pending"
                ? "All owner bank details have been verified!"
                : "Owners with verified bank details will appear here"}
            </Text>
          </View>
        ) : (
          <View style={s.listContainer}>
            {filteredOwners.map((owner, idx) => (
              <TouchableOpacity
                key={owner.uid}
                style={[
                  s.ownerCard,
                  idx === filteredOwners.length - 1 && s.ownerCardLast,
                ]}
                onPress={() => openDetails(owner)}
              >
                {/* Card Border Color */}
                <View
                  style={[
                    s.cardBorderLeft,
                    {
                      backgroundColor: owner.banking.verified
                        ? "#22C55E"
                        : "#F59E0B",
                    },
                  ]}
                />

                {/* Owner Info */}
                <View style={s.ownerCardContent}>
                  <View style={s.ownerTop}>
                    <View style={s.ownerInfo}>
                      <Text style={s.ownerName}>{owner.name}</Text>
                      <Text style={s.ownerBusiness}>{owner.businessName}</Text>
                      <Text style={s.ownerEmail}>{owner.email}</Text>
                    </View>

                    {/* Status Badge */}
                    <View
                      style={[
                        s.statusBadge,
                        {
                          backgroundColor: owner.banking.verified
                            ? "#D1FAE5"
                            : "#FEF3C7",
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          owner.banking.verified
                            ? "checkmark-circle"
                            : "hourglass"
                        }
                        size={14}
                        color={
                          owner.banking.verified ? "#22C55E" : "#F59E0B"
                        }
                      />
                      <Text
                        style={[
                          s.statusBadgeText,
                          {
                            color: owner.banking.verified
                              ? "#15803D"
                              : "#92400E",
                          },
                        ]}
                      >
                        {owner.banking.verified ? "Approved" : "Pending"}
                      </Text>
                    </View>
                  </View>

                  {/* Bank Details Preview */}
                  <View style={s.bankPreview}>
                    <View style={s.bankPreviewItem}>
                      <Text style={s.bankPreviewLabel}>Account Holder</Text>
                      <Text style={s.bankPreviewValue}>
                        {owner.banking.name}
                      </Text>
                    </View>
                    <View style={s.bankPreviewItem}>
                      <Text style={s.bankPreviewLabel}>IFSC</Text>
                      <Text style={s.bankPreviewValue}>
                        {owner.banking.ifsc}
                      </Text>
                    </View>
                    <View style={s.bankPreviewItem}>
                      <Text style={s.bankPreviewLabel}>Account</Text>
                      <Text style={s.bankPreviewValue}>
                        ****{owner.banking.accountNo?.slice(-4)}
                      </Text>
                    </View>
                  </View>

                  {/* Updated Date */}
                  <View style={s.updatedDate}>
                    <Ionicons
                      name="time-outline"
                      size={12}
                      color="#9CA3AF"
                    />
                    <Text style={s.updatedDateText}>
                      {owner.banking.updatedAt
                        ?.toDate?.()
                        .toLocaleDateString("en-IN")}
                    </Text>
                  </View>
                </View>

                {/* Arrow */}
                <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ══ DETAIL MODAL ════════════════════════════════ */}
      {selectedOwner && (
        <Modal
          visible={showDetailModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDetailModal(false)}
        >
          <View style={m.backdrop}>
            <TouchableOpacity
              style={{ flex: 1 }}
              activeOpacity={1}
              onPress={() => setShowDetailModal(false)}
            />
            <View style={m.sheet}>
              <View style={m.handle} />

              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={m.title}>Bank Verification Details</Text>

                {/* Owner Info */}
                <View style={m.section}>
                  <Text style={m.sectionTitle}>Owner Information</Text>
                  <View style={m.infoRow}>
                    <Text style={m.infoLabel}>Name</Text>
                    <Text style={m.infoValue}>{selectedOwner.name}</Text>
                  </View>
                  <View style={m.infoRow}>
                    <Text style={m.infoLabel}>Business</Text>
                    <Text style={m.infoValue}>
                      {selectedOwner.businessName}
                    </Text>
                  </View>
                  <View style={m.infoRow}>
                    <Text style={m.infoLabel}>Email</Text>
                    <Text style={m.infoValue}>{selectedOwner.email}</Text>
                  </View>
                  <View style={m.infoRow}>
                    <Text style={m.infoLabel}>Phone</Text>
                    <Text style={m.infoValue}>{selectedOwner.phone}</Text>
                  </View>
                </View>

                {/* Bank Details */}
                <View style={m.section}>
                  <Text style={m.sectionTitle}>Bank Account Details</Text>
                  <View style={m.bankBox}>
                    <View style={m.bankRow}>
                      <Text style={m.bankLabel}>Account Holder</Text>
                      <Text style={m.bankValue}>
                        {selectedOwner.banking.name}
                      </Text>
                    </View>
                    <View style={m.divider} />

                    <View style={m.bankRow}>
                      <Text style={m.bankLabel}>Account Number</Text>
                      <Text style={m.bankValue}>
                        {selectedOwner.banking.accountNo}
                      </Text>
                    </View>
                    <View style={m.divider} />

                    <View style={m.bankRow}>
                      <Text style={m.bankLabel}>IFSC Code</Text>
                      <Text style={m.bankValue}>
                        {selectedOwner.banking.ifsc}
                      </Text>
                    </View>
                    {selectedOwner.banking.upi && (
                      <>
                        <View style={m.divider} />
                        <View style={m.bankRow}>
                          <Text style={m.bankLabel}>UPI</Text>
                          <Text style={m.bankValue}>
                            {selectedOwner.banking.upi}
                          </Text>
                        </View>
                      </>
                    )}
                  </View>
                </View>

                {/* Verification Status */}
                <View style={m.section}>
                  <Text style={m.sectionTitle}>Verification Status</Text>
                  <View
                    style={[
                      m.statusBox,
                      {
                        backgroundColor: selectedOwner.banking.verified
                          ? "#D1FAE5"
                          : "#FEF3C7",
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        selectedOwner.banking.verified
                          ? "checkmark-circle"
                          : "hourglass"
                      }
                      size={24}
                      color={
                        selectedOwner.banking.verified ? "#22C55E" : "#F59E0B"
                      }
                    />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text
                        style={[
                          m.statusBoxText,
                          {
                            color: selectedOwner.banking.verified
                              ? "#15803D"
                              : "#92400E",
                          },
                        ]}
                      >
                        {selectedOwner.banking.verified
                          ? "✅ Verified & Approved"
                          : "⏳ Pending Verification"}
                      </Text>
                      <Text
                        style={[
                          m.statusBoxSub,
                          {
                            color: selectedOwner.banking.verified
                              ? "#065F46"
                              : "#78350F",
                          },
                        ]}
                      >
                        Updated:{" "}
                        {selectedOwner.banking.updatedAt
                          ?.toDate?.()
                          .toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Action Buttons */}
                {!selectedOwner.banking.verified && (
                  <View style={m.actionButtons}>
                    <TouchableOpacity
                      style={[m.approveBtn, actionLoading && { opacity: 0.6 }]}
                      onPress={() => handleApprove(selectedOwner)}
                      disabled={actionLoading}
                    >
                      {actionLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Ionicons
                            name="checkmark-circle-outline"
                            size={16}
                            color="#fff"
                          />
                          <Text style={m.approveBtnText}>Approve</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[m.rejectBtn, actionLoading && { opacity: 0.6 }]}
                      onPress={() => setShowRejectModal(true)}
                      disabled={actionLoading}
                    >
                      {actionLoading ? (
                        <ActivityIndicator color="#DC2626" />
                      ) : (
                        <>
                          <Ionicons
                            name="close-circle-outline"
                            size={16}
                            color="#DC2626"
                          />
                          <Text style={m.rejectBtnText}>Reject</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {selectedOwner.banking.verified && (
                  <View style={m.approvedNote}>
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={20}
                      color="#22C55E"
                    />
                    <Text style={m.approvedNoteText}>
                      This owner's bank details have been verified. They can
                      now receive settlement payouts.
                    </Text>
                  </View>
                )}

                <View style={{ height: 30 }} />
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* ══ REJECT MODAL ════════════════════════════════ */}
      <Modal
        visible={showRejectModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRejectModal(false)}
      >
        <View style={r.backdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setShowRejectModal(false)}
          />
          <View style={r.sheet}>
            <View style={r.handle} />

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={r.title}>Reject Bank Details</Text>
              <Text style={r.sub}>
                Tell {selectedOwner?.name} why their bank details were rejected
              </Text>

              {/* Warning Box */}
              <View style={r.warningBox}>
                <Ionicons name="alert-circle-outline" size={18} color="#DC2626" />
                <Text style={r.warningText}>
                  The owner will be notified and must resubmit their details.
                </Text>
              </View>

              {/* Reason Input */}
              <Text style={r.label}>Rejection Reason *</Text>
              <TextInput
                style={r.input}
                placeholder="e.g., Invalid IFSC code, Account number mismatch, Incomplete details..."
                placeholderTextColor="#9CA3AF"
                value={rejectReason}
                onChangeText={setRejectReason}
                multiline
                numberOfLines={4}
              />
              <Text style={r.hint}>
                Be specific so the owner knows exactly what to fix
              </Text>

              {/* Action Buttons */}
              <TouchableOpacity
                style={[r.confirmBtn, actionLoading && { opacity: 0.6 }]}
                onPress={handleReject}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="close-circle-outline" size={16} color="#fff" />
                    <Text style={r.confirmTxt}>Confirm Rejection</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={r.cancelBtn}
                onPress={() => setShowRejectModal(false)}
                disabled={actionLoading}
              >
                <Text style={r.cancelTxt}>Cancel</Text>
              </TouchableOpacity>

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  scroll: { paddingBottom: 24 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadText: { marginTop: 12, fontSize: 14, color: "#64748B", fontWeight: "600" },

  // Header
  header: {
    backgroundColor: "#0A0F1E",
    paddingHorizontal: 20,
    
    paddingBottom: 24,
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

  // Statistics
  statsContainer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    marginVertical: 20,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
  },
  statCardPending: { backgroundColor: "#FFFBEB", borderColor: "#FEF3C7" },
  statCardApproved: { backgroundColor: "#F0FDF4", borderColor: "#DCFCE7" },
  statCardTotal: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
  statIconBox: { marginBottom: 8 },
  statNumber: {
    fontSize: 24,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
    textTransform: "uppercase",
  },

  // Search
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#0F172A",
  },

  // Tabs
  tabsContainer: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginVertical: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
  },
  tabActive: { backgroundColor: "#3B82F6" },
  tabText: { fontSize: 12, fontWeight: "700", color: "#64748B" },
  tabTextActive: { color: "#fff" },

  // Empty State
  emptyState: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 12,
  },
  emptyStateSub: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 4,
    textAlign: "center",
    paddingHorizontal: 16,
  },

  // List
  listContainer: { paddingHorizontal: 16 },
  ownerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
  },
  ownerCardLast: { marginBottom: 0 },
  cardBorderLeft: { width: 4, height: "100%" },
  ownerCardContent: { flex: 1, padding: 14 },
  ownerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  ownerInfo: { flex: 1 },
  ownerName: { fontSize: 15, fontWeight: "800", color: "#0F172A" },
  ownerBusiness: { fontSize: 12, color: "#64748B", marginTop: 2 },
  ownerEmail: { fontSize: 12, color: "#94A3B8", marginTop: 1 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusBadgeText: { fontSize: 11, fontWeight: "700" },

  // Bank Preview
  bankPreview: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    gap: 8,
  },
  bankPreviewItem: { flexDirection: "row", justifyContent: "space-between" },
  bankPreviewLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94A3B8",
    textTransform: "uppercase",
  },
  bankPreviewValue: { fontSize: 12, fontWeight: "700", color: "#0F172A" },

  // Updated Date
  updatedDate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  updatedDateText: {
    fontSize: 11,
    color: "#94A3B8",
  },
});

// ── Modal Styles ──────────────────────────────────────────────────────────
const m = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "92%",
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

  // Sections
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Info Row
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  infoLabel: { fontSize: 12, color: "#64748B", fontWeight: "700" },
  infoValue: { fontSize: 13, fontWeight: "800", color: "#0F172A" },

  // Bank Box
  bankBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16,
  },
  bankRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  },
  bankLabel: { fontSize: 12, color: "#64748B", fontWeight: "700" },
  bankValue: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "right",
    flex: 1,
    marginLeft: 12,
  },
  divider: { height: 1, backgroundColor: "#E2E8F0" },

  // Status Box
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
  },
  statusBoxText: { fontSize: 14, fontWeight: "800" },
  statusBoxSub: { fontSize: 11, marginTop: 3 },

  // Action Buttons
  actionButtons: { gap: 10, marginTop: 24 },
  approveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#22C55E",
    paddingVertical: 14,
    borderRadius: 12,
  },
  approveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  rejectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FEE2E2",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  rejectBtnText: { color: "#DC2626", fontWeight: "800", fontSize: 15 },

  // Approved Note
  approvedNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#F0FDF4",
    borderRadius: 12,
    padding: 14,
    marginTop: 24,
    borderLeftWidth: 4,
    borderLeftColor: "#22C55E",
  },
  approvedNoteText: {
    flex: 1,
    fontSize: 12,
    color: "#15803D",
    fontWeight: "600",
    lineHeight: 18,
  },
});

// ── Reject Modal Styles ────────────────────────────────────────────────────
const r = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "80%",
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
  title: {
    fontSize: 20,
    fontWeight: "900",
    color: "#DC2626",
    marginBottom: 6,
  },
  sub: {
    fontSize: 13,
    color: "#6B7280",
    marginBottom: 16,
    lineHeight: 20,
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FEE2E2",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#DC2626",
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: "#7F1D1D",
    fontWeight: "600",
    lineHeight: 18,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#111827",
    minHeight: 80,
    textAlignVertical: "top",
  },
  hint: {
    fontSize: 11,
    color: "#9CA3AF",
    marginTop: 6,
    fontWeight: "500",
  },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#DC2626",
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 20,
  },
  confirmTxt: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 15,
  },
  cancelBtn: {
    backgroundColor: "#F3F4F6",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
  },
  cancelTxt: {
    color: "#374151",
    fontWeight: "700",
    fontSize: 15,
  },
});
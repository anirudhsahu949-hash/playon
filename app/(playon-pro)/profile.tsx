import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  ActivityIndicator,
  TextInput,
  Alert,
  Keyboard,
  Modal,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { db, auth } from "../../firebaseConfig";
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged, getIdToken } from "firebase/auth";
import { Ionicons } from "@expo/vector-icons";
// @ts-ignore
import RazorpayCheckout from "react-native-razorpay";
import { useRouter } from "expo-router";

// =======================================================
// 👤 USER PLAYER PROFILE  (app/(tabs)/profile.tsx)
// =======================================================

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const GREEN      = "#16A34A";
const DARK       = "#0B1220";

// ── Sport lists ───────────────────────────────────────────────────────────────
const SPORTS_LIST = [
  "Cricket", "Football", "Badminton",
  "Basketball", "Volleyball", "Pickleball",
  "Tennis", "Table Tennis",
];

// Player roles per sport — shown after sport selection
const SPORT_ROLES: Record<string, { label: string; value: string }[]> = {
  Cricket: [
    { label: "Batsman",    value: "batsman"    },
    { label: "Bowler",     value: "bowler"     },
    { label: "All-Rounder",value: "allrounder" },
    { label: "Wicket Keeper", value: "keeper"  },
  ],
  Football: [
    { label: "Goalkeeper",  value: "goalkeeper"  },
    { label: "Defender",    value: "defender"    },
    { label: "Midfielder",  value: "midfielder"  },
    { label: "Forward",     value: "forward"     },
  ],
  Badminton: [
    { label: "Singles",    value: "singles"    },
    { label: "Doubles",    value: "doubles"    },
    { label: "Mixed",      value: "mixed"      },
  ],
  Basketball: [
    { label: "Point Guard",  value: "pg"  },
    { label: "Shooting Guard",value:"sg"  },
    { label: "Small Forward",value: "sf"  },
    { label: "Power Forward",value: "pf"  },
    { label: "Center",       value: "c"   },
  ],
  Volleyball: [
    { label: "Setter",    value: "setter"    },
    { label: "Libero",    value: "libero"    },
    { label: "Spiker",    value: "spiker"    },
    { label: "Blocker",   value: "blocker"   },
  ],
};

// Cricket sub-fields
const BATTING_HANDS  = ["Right Hand", "Left Hand"];
const BOWLING_STYLES = [
  "Right Arm Fast", "Right Arm Medium", "Right Arm Spin",
  "Left Arm Fast",  "Left Arm Medium",  "Left Arm Spin",
  "Does Not Bowl",
];

// ── helpers ───────────────────────────────────────────────────────────────────
function getInitials(name: string): string {
  if (!name) return "P";
  return name.trim().split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function slugify(name: string): string {
  return name
    .toLowerCase().trim()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 20);
}

// Primary sport = first in the list, for role/stats context
function primarySport(sports: string[]): string {
  return sports?.[0] || "";
}

// ── Types ─────────────────────────────────────────────────────────────────────
type PlayerStats = {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  // cricket
  runs: number;
  wickets: number;
  fifties: number;
  hundreds: number;
  // football
  goals: number;
  assists: number;
  // generic
  points: number;
};

type PlayerProfile = {
  playonId: string;
  displayName: string;
  displayNameLower?: string;
  sports: string[];
  bio: string;
  age?: number | null;
  playerRole?: string;      // e.g. "batsman", "goalkeeper"
  battingHand?: string;     // cricket only
  bowlingStyle?: string;    // cricket only
  stats: PlayerStats;
  rating: number;
  isProPlayer: boolean;
  createdAt: any;
  expiresAt?: any;          // Firestore Timestamp — profile valid for 1 year
  isExpired?: boolean;      // set true by server if past expiry
};

// NOTE: removed `fee` (creation fee) entirely — creation is always free now.
// renewalFee stays so the existing renewal flow keeps working untouched.
type ProfileConfig = {
  renewalFee: number; // yearly renewal fee (0 = free renewal)
  enabled: boolean;   // admin kill-switch for profile creation
};

// ─────────────────────────────────────────────────────────────────────────────
export default function UserProfile() {
  
  const [authLoading, setAuthLoading]       = useState(true);
  const [userName, setUserName]             = useState("");
  const [userPhone, setUserPhone]           = useState("");
  const [uid, setUid]                       = useState<string | null>(null);

  const [profile, setProfile]               = useState<PlayerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [config, setConfig]                 = useState<ProfileConfig>({ renewalFee: 0, enabled: true });
  const [configLoading, setConfigLoading]   = useState(true);

  // creation modal state
  const [showCreate, setShowCreate]         = useState(false);
  const [playonId, setPlayonId]             = useState("");
  const [idTaken, setIdTaken]               = useState(false);
  const [idChecking, setIdChecking]         = useState(false);
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [playerRole, setPlayerRole]         = useState("");
  const [battingHand, setBattingHand]       = useState("");
  const [bowlingStyle, setBowlingStyle]     = useState("");
  const [age, setAge]                       = useState("");
  const [bio, setBio]                       = useState("");
  const [creating, setCreating]             = useState(false);
  const [renewing, setRenewing]             = useState(false); // renewal Razorpay flow

  // ── Auth listener ────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setAuthLoading(false); return; }
      setUid(user.uid);
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          const u = snap.data();
          setUserName(u.name || "Player");
          setUserPhone(u.phone || "");
        }
      } catch { /* silent */ }
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  const loadProfile = useCallback(async (currentUid: string) => {
    setProfileLoading(true);
    try {
      const snap = await getDoc(doc(db, "playerProfiles", currentUid));
      if (snap.exists()) {
        const data = snap.data() as PlayerProfile;
        // Check expiry client-side too (expiresAt is a Firestore Timestamp)
        if (data.expiresAt) {
          const expDate = data.expiresAt?.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
          if (expDate < new Date()) {
            data.isExpired = true;
          }
        }
        setProfile(data);
      } else {
        setProfile(null);
      }
    } catch (e) { console.error("load profile", e); }
    finally { setProfileLoading(false); }
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const snap = await getDoc(doc(db, "appConfig", "playerProfile"));
      if (snap.exists()) {
        const d = snap.data();
        setConfig({
          renewalFee: Number(d.renewalFee ?? 0),
          enabled: d.enabled !== false,
        });
      }
    } catch (e) { console.error("load config", e); }
    finally { setConfigLoading(false); }
  }, []);

  useEffect(() => {
    if (uid) { loadProfile(uid); loadConfig(); }
  }, [uid]);

  // ── Playon ID uniqueness check ───────────────────────────────────────────
  useEffect(() => {
    if (!playonId || playonId.length < 3) { setIdTaken(false); return; }
    setIdChecking(true);
    const timer = setTimeout(async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "playerProfiles"), where("playonId", "==", playonId.toLowerCase()))
        );
        setIdTaken(!snap.empty);
      } catch { /* silent */ }
      setIdChecking(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [playonId]);

  const openCreate = () => {
    setPlayonId(slugify(userName));
    setSelectedSports([]); setPlayerRole(""); setBattingHand("");
    setBowlingStyle(""); setAge(""); setBio(""); setIdTaken(false);
    setShowCreate(true);
  };

  const toggleSport = (s: string) => {
    setSelectedSports((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      // reset role when primary sport changes
      if (next[0] !== prev[0]) setPlayerRole("");
      return next;
    });
  };

  // ── Validate ─────────────────────────────────────────────────────────────
  const validateForm = (): boolean => {
    const id = playonId.trim().toLowerCase();
    if (id.length < 3) { Alert.alert("Too short", "Playon ID must be at least 3 characters."); return false; }
    if (!/^[a-z0-9_]+$/.test(id)) { Alert.alert("Invalid ID", "Only lowercase letters, numbers and underscores."); return false; }
    if (idTaken) { Alert.alert("ID taken", "This Playon ID is already in use. Try another."); return false; }
    if (selectedSports.length === 0) { Alert.alert("Select a sport", "Pick at least one sport you play."); return false; }
    if (age && (isNaN(Number(age)) || Number(age) < 5 || Number(age) > 80)) {
      Alert.alert("Invalid age", "Age must be between 5 and 80."); return false;
    }
    return true;
  };

  // ── Build profile data object ─────────────────────────────────────────────
  const buildProfileData = (): Omit<PlayerProfile, "createdAt"> => ({
    playonId:          playonId.trim().toLowerCase(),
    displayName:       userName,
    displayNameLower:  userName.trim().toLowerCase(),
    sports:            selectedSports,
    bio:               bio.trim(),
    age:               age ? Number(age) : null,
    playerRole:        playerRole || null,
    battingHand:       battingHand || null,
    bowlingStyle:      bowlingStyle || null,
    stats: {
      matches: 0, wins: 0, losses: 0, draws: 0,
      runs: 0, wickets: 0, fifties: 0, hundreds: 0,
      goals: 0, assists: 0, points: 0,
    },
    rating:      0,
    isProPlayer: false,
  } as any);

  // ── Profile creation — always free now ───────────────────────────────────
  const createFreeProfile = async () => {
    if (!uid || !validateForm()) return;
    Keyboard.dismiss();
    setCreating(true);
    try {
      // Expiry: 1 year from now
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      const data = {
        ...buildProfileData(),
        isExpired: false,
        expiresAt,           // plain Date — Firestore converts it
        createdAt: serverTimestamp(),
      };
      await setDoc(doc(db, "playerProfiles", uid), data);
      setProfile({ ...data, createdAt: new Date() } as PlayerProfile);
      setShowCreate(false);
      Alert.alert("🎉 Welcome to Playon Pro!", `Your ID @${data.playonId} is ready. Valid for 1 year.`);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not create profile. Try again.");
    } finally { setCreating(false); }
  };

  const handleCreate = () => createFreeProfile();

  // ── FREE RENEWAL path (renewalFee = 0) ───────────────────────────────────
  const renewFreeProfile = async () => {
    if (!uid || !profile) return;
    setRenewing(true);
    try {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      await setDoc(doc(db, "playerProfiles", uid), {
        expiresAt,
        isExpired: false,
        lastRenewedAt: serverTimestamp(),
      }, { merge: true });
      await loadProfile(uid);
      Alert.alert("✅ Renewed!", "Your Playon Pro profile is active for another year.");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not renew. Try again.");
    } finally { setRenewing(false); }
  };

  // ── PAID RENEWAL path (kept as-is — only creation payment was removed) ──
  const renewPaidProfile = async () => {
    if (!uid || !profile) return;
    setRenewing(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not logged in.");
      const token = await getIdToken(user);

      const orderRes = await fetch(`${SERVER_URL}/create-player-profile-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ isRenewal: true }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok || !order.orderId) throw new Error(order.error || "Could not start renewal.");

      const options = {
        key: order.key, order_id: order.orderId,
        amount: order.amount, currency: order.currency || "INR",
        name: "Playon", description: "Playon Pro — Annual Renewal",
        prefill: { name: userName, contact: userPhone, email: auth.currentUser?.email || "" },
        theme: { color: GREEN },
      };

      const payment = await RazorpayCheckout.open(options);

      const verifyRes = await fetch(`${SERVER_URL}/verify-player-profile-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id:   payment.razorpay_order_id,
          payment_id: payment.razorpay_payment_id,
          signature:  payment.razorpay_signature,
        }),
      });
      const verify = await verifyRes.json();
      if (verify.success) {
        await loadProfile(uid);
        Alert.alert("✅ Renewed!", "Your Playon Pro profile is active for another year.");
      } else {
        throw new Error(verify.error || "Renewal verification failed.");
      }
    } catch (e: any) {
      const msg: string = e?.message || "";
      if (msg.toLowerCase().includes("cancel")) Alert.alert("Cancelled", "Renewal cancelled.");
      else Alert.alert("Renewal Failed", msg || "Something went wrong. Try again.");
    } finally { setRenewing(false); }
  };

  const handleRenew = () => {
    if (config.renewalFee > 0) renewPaidProfile();
    else renewFreeProfile();
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (authLoading || profileLoading || configLoading) {
    return (
      <SafeAreaView style={[s.root, s.center]}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <ActivityIndicator color={GREEN} />
      </SafeAreaView>
    );
  }

  if (profile) {
    if (profile.isExpired) {
      // Expired — show renewal gate instead of live profile
      return (
        <RenewalGate
          profile={profile}
          userName={userName}
          userPhone={userPhone}
          renewalFee={config.renewalFee}
          renewing={renewing}
          onRenew={handleRenew}
        />
      );
    }
    return (
      <LiveProfile
        profile={profile}
        userName={userName}
        userPhone={userPhone}
        uid={uid}
        renewalFee={config.renewalFee}
        onRenew={handleRenew}
        renewing={renewing}
      />
    );
  }

  // ── Gate screen ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">

        <View style={s.head}>
          <View style={s.avatar}><Text style={s.avatarTxt}>{getInitials(userName)}</Text></View>
          <Text style={s.name}>{userName}</Text>
          {!!userPhone && <Text style={s.phone}>{userPhone}</Text>}
          <View style={s.tierBadge}>
            <Ionicons name="person-outline" size={12} color="#6B7280" />
            <Text style={s.tierTxt}>Free Player</Text>
          </View>
        </View>

        <View style={s.statsRow}>
          {[{ label: "Matches", value: "0" }, { label: "Won", value: "0" }, { label: "Win rate", value: "—" }].map((st) => (
            <View key={st.label} style={s.statTile}>
              <Text style={s.statValue}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Redesigned unlock card — free, no pricing language anywhere ── */}
        {config.enabled && (
          <View style={s.unlockCard}>
            <View style={s.unlockGlow} />
            <View style={s.unlockTop}>
              <View style={s.unlockBadge}>
                <Ionicons name="star" size={18} color="#15803D" />
                <Text style={s.unlockBadgeTxt}>Playon Pro</Text>
              </View>
              <View style={s.freeTag}>
                <Text style={s.freeTagTxt}>FREE</Text>
              </View>
            </View>
            <Text style={s.unlockTitle}>Create your Playon ID</Text>
            <Text style={s.unlockSub}>
              Your public player identity on Playon — completely free. League owners can add you to
              teams using your unique ID. Track stats, league history and your player rating — all in one place.
            </Text>
            {[
              { icon: "at-outline",               text: "Unique @PlayonID visible to league organizers" },
              { icon: "trophy-outline",            text: "League history & match stats automatically tracked" },
              { icon: "stats-chart-outline",       text: "Sport-specific stats — runs, wickets, goals and more" },
              { icon: "shield-checkmark-outline",  text: "Verified Pro badge on your profile" },
            ].map((f) => (
              <View key={f.text} style={s.featureRow}>
                <View style={s.featureDot}><Ionicons name={f.icon as any} size={14} color={GREEN} /></View>
                <Text style={s.featureTxt}>{f.text}</Text>
              </View>
            ))}
            <TouchableOpacity style={s.unlockBtn} onPress={openCreate} activeOpacity={0.85}>
              <Ionicons name="flash" size={16} color="#fff" />
              <Text style={s.unlockBtnTxt}>Create your Playon ID — Free</Text>
            </TouchableOpacity>
            <Text style={s.oneTimeNote}>Takes less than a minute · No payment required</Text>
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionTitle}>League history</Text>
          <View style={s.historyEmpty}>
            <Ionicons name="trophy-outline" size={22} color="#D1D5DB" />
            <Text style={s.historyEmptyTxt}>No leagues played yet</Text>
          </View>
        </View>
      </ScrollView>

      <CreateModal
        visible={showCreate}
        onClose={() => !creating && setShowCreate(false)}
        playonId={playonId}
        setPlayonId={(v) => setPlayonId(v.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
        idTaken={idTaken}
        idChecking={idChecking}
        selectedSports={selectedSports}
        toggleSport={toggleSport}
        playerRole={playerRole}
        setPlayerRole={setPlayerRole}
        battingHand={battingHand}
        setBattingHand={setBattingHand}
        bowlingStyle={bowlingStyle}
        setBowlingStyle={setBowlingStyle}
        age={age}
        setAge={setAge}
        bio={bio}
        setBio={setBio}
        creating={creating}
        onSubmit={handleCreate}
      />
    </SafeAreaView>
  );
}

// =============================================================================
// CREATE PROFILE MODAL — payment removed, always free
// =============================================================================
function CreateModal({
  visible, onClose,
  playonId, setPlayonId, idTaken, idChecking,
  selectedSports, toggleSport,
  playerRole, setPlayerRole,
  battingHand, setBattingHand,
  bowlingStyle, setBowlingStyle,
  age, setAge,
  bio, setBio,
  creating, onSubmit,
}: {
  visible: boolean; onClose: () => void;
  playonId: string; setPlayonId: (v: string) => void;
  idTaken: boolean; idChecking: boolean;
  selectedSports: string[]; toggleSport: (s: string) => void;
  playerRole: string; setPlayerRole: (v: string) => void;
  battingHand: string; setBattingHand: (v: string) => void;
  bowlingStyle: string; setBowlingStyle: (v: string) => void;
  age: string; setAge: (v: string) => void;
  bio: string; setBio: (v: string) => void;
  creating: boolean; onSubmit: () => void;
}) {
  const busy    = creating;
  const primary = selectedSports[0] || "";
  const roles   = SPORT_ROLES[primary] || [];
  const isCricket = primary === "Cricket";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={m.backdrop}>
        <View style={m.sheet}>
          <View style={m.handle} />

          <View style={m.header}>
            <Text style={m.headerTitle}>Create Playon ID</Text>
            <TouchableOpacity onPress={onClose} disabled={busy} hitSlop={10}>
              <Ionicons name="close" size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>

            {/* ── Playon ID ── */}
            <Text style={m.label}>Your Playon ID *</Text>
            <View style={m.idRow}>
              <Text style={m.atSign}>@</Text>
              <TextInput
                style={[m.idInput,
                  idTaken && { borderColor: "#EF4444" },
                  !idTaken && playonId.length >= 3 && { borderColor: GREEN },
                ]}
                value={playonId} onChangeText={setPlayonId}
                placeholder="your_id" placeholderTextColor="#9CA3AF"
                autoCapitalize="none" autoCorrect={false} maxLength={24}
              />
              <View style={m.idStatus}>
                {idChecking
                  ? <ActivityIndicator size="small" color="#9CA3AF" />
                  : idTaken
                    ? <Ionicons name="close-circle" size={18} color="#EF4444" />
                    : playonId.length >= 3
                      ? <Ionicons name="checkmark-circle" size={18} color={GREEN} />
                      : null}
              </View>
            </View>
            {idTaken && <Text style={m.idError}>This ID is already taken. Try another one.</Text>}
            <Text style={m.idHint}>Lowercase letters, numbers and underscore only. Can't change this later.</Text>

            {/* ── Sports ── */}
            <Text style={m.label}>Sports you play *</Text>
            <Text style={m.sublabel}>First selected = primary sport (used for role & stats)</Text>
            <View style={m.chipsWrap}>
              {SPORTS_LIST.map((sp) => {
                const active = selectedSports.includes(sp);
                const isPrimary = selectedSports[0] === sp;
                return (
                  <TouchableOpacity
                    key={sp}
                    style={[m.chip, active && m.chipActive]}
                    onPress={() => toggleSport(sp)}
                  >
                    <Text style={[m.chipTxt, active && m.chipTxtActive]}>
                      {isPrimary ? "★ " : ""}{sp}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── Player role (sport-specific) ── */}
            {roles.length > 0 && (
              <>
                <Text style={m.label}>Your role in {primary} *</Text>
                <View style={m.chipsWrap}>
                  {roles.map((r) => {
                    const active = playerRole === r.value;
                    return (
                      <TouchableOpacity
                        key={r.value}
                        style={[m.chip, active && m.chipActive]}
                        onPress={() => setPlayerRole(active ? "" : r.value)}
                      >
                        <Text style={[m.chipTxt, active && m.chipTxtActive]}>{r.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* ── Cricket sub-fields ── */}
            {isCricket && (
              <>
                <Text style={m.label}>Batting hand</Text>
                <View style={m.chipsWrap}>
                  {BATTING_HANDS.map((h) => {
                    const active = battingHand === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        style={[m.chip, active && m.chipActive]}
                        onPress={() => setBattingHand(active ? "" : h)}
                      >
                        <Text style={[m.chipTxt, active && m.chipTxtActive]}>{h}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={m.label}>Bowling style</Text>
                <View style={m.chipsWrap}>
                  {BOWLING_STYLES.map((bs) => {
                    const active = bowlingStyle === bs;
                    return (
                      <TouchableOpacity
                        key={bs}
                        style={[m.chip, active && m.chipActive]}
                        onPress={() => setBowlingStyle(active ? "" : bs)}
                      >
                        <Text style={[m.chipTxt, active && m.chipTxtActive]}>{bs}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* ── Age (optional) ── */}
            <Text style={m.label}>Age <Text style={m.optionalTag}>(optional)</Text></Text>
            <TextInput
              style={m.ageInput}
              value={age}
              onChangeText={(v) => setAge(v.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 22"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              maxLength={2}
            />

            {/* ── Bio ── */}
            <Text style={m.label}>Short bio <Text style={m.optionalTag}>(optional)</Text></Text>
            <TextInput
              style={m.bioInput}
              value={bio} onChangeText={setBio}
              placeholder="e.g. Right arm fast · Amravati · 5 yrs playing"
              placeholderTextColor="#9CA3AF"
              multiline maxLength={120}
            />
            <Text style={m.bioCount}>{bio.length}/120</Text>

            {/* ── Free notice — replaces old fee box ── */}
            <View style={[m.feeBox, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}>
              <Ionicons name="checkmark-circle-outline" size={18} color={GREEN} />
              <Text style={[m.feeTxt, { color: "#15803D" }]}>Creating your Playon ID is completely free.</Text>
            </View>

            {/* ── Submit ── */}
            <TouchableOpacity
              style={[m.submitBtn, busy && { opacity: 0.6 }]}
              onPress={onSubmit} disabled={busy} activeOpacity={0.85}
            >
              {busy
                ? <ActivityIndicator color="#fff" />
                : <>
                    <Ionicons name="flash" size={17} color="#fff" />
                    <Text style={m.submitTxt}>Create my Playon ID</Text>
                  </>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// =============================================================================
// LIVE PROFILE  — now includes "Run your own league" card
// =============================================================================
function LiveProfile({ profile, userName, userPhone, uid, renewalFee, onRenew, renewing }: {
  profile: PlayerProfile; userName: string; userPhone: string; uid: string | null;
  renewalFee: number; onRenew: () => void; renewing: boolean;
}) {
  const stats       = profile.stats ?? {} as PlayerStats;
  const matches     = Number(stats.matches  || 0);
  const wins        = Number(stats.wins     || 0);
  const winRate     = matches > 0 ? Math.round((wins / matches) * 100) : 0;
  const primary     = primarySport(profile.sports);
  const isCricket   = primary === "Cricket";
  const isFootball  = primary === "Football";
  const router = useRouter();

  const roleLabel = (() => {
    const roles = SPORT_ROLES[primary] || [];
    return roles.find((r) => r.value === profile.playerRole)?.label || null;
  })();

  // ── 4 headline stats (sport-aware) ───────────────────────────────────────
  const headlineStats = (() => {
    if (isCricket) return [
      { icon: "baseball-outline",     color: "#7C3AED", bg: "#EDE9FE", label: "Matches", value: String(matches) },
      { icon: "trending-up-outline",  color: "#F59E0B", bg: "#FEF3C7", label: "Runs",    value: String(stats.runs || 0) },
      { icon: "ellipse-outline",      color: "#10B981", bg: "#D1FAE5", label: "Wickets", value: String(stats.wickets || 0) },
      { icon: "star-outline",         color: "#6366F1", bg: "#EEF2FF", label: "Points",  value: String(Math.round((stats.runs || 0) * 1.5 + (stats.wickets || 0) * 25)) },
    ];
    if (isFootball) return [
      { icon: "football-outline",     color: "#7C3AED", bg: "#EDE9FE", label: "Matches", value: String(matches) },
      { icon: "trending-up-outline",  color: "#F59E0B", bg: "#FEF3C7", label: "Goals",   value: String(stats.goals || 0) },
      { icon: "git-branch-outline",   color: "#10B981", bg: "#D1FAE5", label: "Assists", value: String(stats.assists || 0) },
      { icon: "star-outline",         color: "#6366F1", bg: "#EEF2FF", label: "Points",  value: String((stats.goals || 0) * 3 + (stats.assists || 0)) },
    ];
    return [
      { icon: "trophy-outline",       color: "#7C3AED", bg: "#EDE9FE", label: "Matches", value: String(matches) },
      { icon: "checkmark-circle-outline", color: "#F59E0B", bg: "#FEF3C7", label: "Won",  value: String(wins) },
      { icon: "close-circle-outline", color: "#10B981", bg: "#D1FAE5", label: "Lost",   value: String(stats.losses || 0) },
      { icon: "star-outline",         color: "#6366F1", bg: "#EEF2FF", label: "Win%",   value: winRate > 0 ? `${winRate}%` : "—" },
    ];
  })();

  // ── Performance overview metrics (sport-aware) ────────────────────────────
  const perfMetrics = (() => {
    if (isCricket) return [
      { label: "Batting Avg",  value: matches > 0 ? ((stats.runs || 0) / matches).toFixed(2) : "—" },
      { label: "Strike Rate",  value: "—" },
      { label: "Best Score",   value: stats.hundreds > 0 ? "100+" : stats.fifties > 0 ? "50+" : "—" },
      { label: "Economy",      value: "—" },
    ];
    if (isFootball) return [
      { label: "Goals/Game",   value: matches > 0 ? ((stats.goals || 0) / matches).toFixed(2) : "—" },
      { label: "Assists/Game", value: matches > 0 ? ((stats.assists || 0) / matches).toFixed(2) : "—" },
      { label: "Win Rate",     value: winRate > 0 ? `${winRate}%` : "—" },
      { label: "Clean Sheets", value: "—" },
    ];
    return [
      { label: "Matches",  value: String(matches) },
      { label: "Win Rate", value: winRate > 0 ? `${winRate}%` : "—" },
      { label: "Won",      value: String(wins) },
      { label: "Lost",     value: String(stats.losses || 0) },
    ];
  })();

  // ── Achievements (static placeholders until engine writes them) ───────────
  const achievements = (() => {
    if (isCricket) return [
      { icon: "medal-outline",   iconColor: "#7C3AED", bg: "#EDE9FE", title: "Most Runs",    sub: "This Season", value: String(stats.runs || 0),     valueColor: "#111827" },
      { icon: "baseball-outline",iconColor: "#F59E0B", bg: "#FEF3C7", title: "Best Batter",  sub: stats.hundreds > 0 ? "This Season" : "—", value: stats.hundreds > 0 ? "Awarded" : "—", valueColor: "#F59E0B" },
      { icon: "tennisball-outline",iconColor:"#10B981", bg: "#D1FAE5", title: "50+ Scores",  sub: "This Season", value: String(stats.fifties || 0),   valueColor: "#111827" },
      { icon: "ribbon-outline",  iconColor: "#3B82F6", bg: "#DBEAFE", title: "MVP",          sub: `${wins} Times`,  value: wins > 0 ? "Won" : "—",       valueColor: "#3B82F6" },
    ];
    if (isFootball) return [
      { icon: "medal-outline",   iconColor: "#7C3AED", bg: "#EDE9FE", title: "Top Scorer",   sub: "This Season", value: String(stats.goals || 0),    valueColor: "#111827" },
      { icon: "football-outline",iconColor: "#F59E0B", bg: "#FEF3C7", title: "Best Player",  sub: "—",           value: wins > 0 ? "Awarded" : "—",   valueColor: "#F59E0B" },
      { icon: "git-branch-outline",iconColor:"#10B981",bg: "#D1FAE5", title: "Assists",      sub: "This Season", value: String(stats.assists || 0),   valueColor: "#111827" },
      { icon: "ribbon-outline",  iconColor: "#3B82F6", bg: "#DBEAFE", title: "MVP",          sub: `${wins} Times`,  value: wins > 0 ? "Won" : "—",       valueColor: "#3B82F6" },
    ];
    return [
      { icon: "medal-outline",   iconColor: "#7C3AED", bg: "#EDE9FE", title: "Matches",      sub: "Played",      value: String(matches),              valueColor: "#111827" },
      { icon: "trophy-outline",  iconColor: "#F59E0B", bg: "#FEF3C7", title: "Wins",         sub: "This Season", value: String(wins),                 valueColor: "#F59E0B" },
      { icon: "star-outline",    iconColor: "#10B981", bg: "#D1FAE5", title: "Win Rate",      sub: "This Season", value: winRate > 0 ? `${winRate}%` : "—", valueColor: "#111827" },
      { icon: "ribbon-outline",  iconColor: "#3B82F6", bg: "#DBEAFE", title: "MVP",          sub: `${wins} Times`,  value: wins > 0 ? "Won" : "—",       valueColor: "#3B82F6" },
    ];
  })();

  return (
    <SafeAreaView style={lp.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8F9FB" />

      {/* ── TOP BAR ── */}
      <View style={lp.topBar}>
        <Text style={lp.topLogo}>
          <Text style={{ color: "#1A1A2E" }}>PLAY</Text>
          <Text style={{ color: "#5B21B6" }}>ON</Text>
          <Text style={{ color: "#7C3AED", fontSize: 14 }}>▸</Text>
        </Text>
        <View style={lp.topIcons}>
          <TouchableOpacity style={lp.topIconBtn}>
            <Ionicons name="notifications-outline" size={20} color="#1A1A2E" />
            <View style={lp.notifDot} />
          </TouchableOpacity>
          <TouchableOpacity style={lp.topIconBtn}>
            <Ionicons name="settings-outline" size={20} color="#1A1A2E" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ── PROFILE CARD ── */}
        <View style={lp.profileCard}>
          {/* Left: avatar */}
          <View style={lp.avatarWrap}>
            <View style={lp.avatar}>
              <Text style={lp.avatarTxt}>{getInitials(profile.displayName || userName)}</Text>
            </View>
            <View style={lp.editDot}>
              <Ionicons name="pencil" size={11} color="#fff" />
            </View>
          </View>

          {/* Centre: name + handle + location */}
          <View style={lp.profileMeta}>
            <View style={lp.nameRow}>
              <Text style={lp.profileName} numberOfLines={1}>
                {profile.displayName || userName}
              </Text>
              <Ionicons name="checkmark-circle" size={18} color="#5B21B6" />
            </View>
            <Text style={lp.profileHandle}>@{profile.playonId}</Text>
            {(!!profile.age || !!roleLabel) && (
              <View style={lp.profileLocation}>
                <Ionicons name="location-outline" size={12} color="#6B7280" />
                <Text style={lp.profileLocationTxt}>
                  {roleLabel || primary}{profile.age ? `, Age ${profile.age}` : ""}
                </Text>
              </View>
            )}
          </View>

          {/* Edit Profile button */}
           <TouchableOpacity
  style={lp.editBtn}
  onPress={() => router.push("/(playon-pro)/edit-player-profile")}
>
  <Ionicons name="person-outline" size={13} color="#374151" />
  <Text style={lp.editBtnTxt}>Edit Profile</Text>
</TouchableOpacity>
        </View>

        {/* Expiry banner (only when needed) */}
        <ExpiryBadge expiresAt={profile.expiresAt} />
        <RenewPrompt expiresAt={profile.expiresAt} renewalFee={renewalFee} onRenew={onRenew} renewing={renewing} />

        {/* ── 4-STAT BAR ── */}
        <View style={lp.statBar}>
          {headlineStats.map((st, i) => (
            <View key={st.label} style={[lp.statCell, i < 3 && lp.statCellBorder]}>
              <View style={[lp.statIconWrap, { backgroundColor: st.bg }]}>
                <Ionicons name={st.icon as any} size={16} color={st.color} />
              </View>
              <Text style={lp.statCellLabel}>{st.label}</Text>
              <Text style={lp.statCellValue}>{st.value}</Text>
            </View>
          ))}
        </View>

        {/* ── PERFORMANCE OVERVIEW ── */}
        <View style={lp.section}>
          <View style={lp.sectionHeader}>
            <Text style={lp.sectionTitle}>Performance Overview</Text>
            <TouchableOpacity style={lp.seasonBtn}>
              <Text style={lp.seasonBtnTxt}>This Season</Text>
              <Ionicons name="chevron-down" size={13} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* 2x2 grid */}
          <View style={lp.perfGrid}>
            {perfMetrics.map((m, i) => (
              <View key={m.label} style={[
                lp.perfCell,
                i % 2 === 0 && lp.perfCellRight,
                i < 2 && lp.perfCellBottom,
              ]}>
                <Text style={lp.perfLabel}>{m.label}</Text>
                <Text style={lp.perfValue}>{m.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── ACHIEVEMENTS ── */}
        <View style={lp.section}>
          <Text style={lp.sectionTitle}>Achievements</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={lp.achScroll}>
            {achievements.map((ach) => (
              <View key={ach.title} style={lp.achCard}>
                <View style={[lp.achIconWrap, { backgroundColor: ach.bg }]}>
                  <Ionicons name={ach.icon as any} size={28} color={ach.iconColor} />
                </View>
                <Text style={lp.achTitle}>{ach.title}</Text>
                <Text style={lp.achSub}>{ach.sub}</Text>
                <Text style={[lp.achValue, { color: ach.valueColor }]}>{ach.value}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* ── Run your own league — NEW ── */}
        <View style={lp.section}>
          <View style={lp.hostCard}>
            <View style={lp.hostIconWrap}>
              <Ionicons name="trophy" size={20} color="#7C3AED" />
            </View>
            <Text style={lp.hostTitle}>Run your own league</Text>
            <Text style={lp.hostSub}>
              Organize a league in your city — fixtures, teams and live scoring, all handled on Playon.
            </Text>
            <View style={lp.hostBtnRow}>
              <TouchableOpacity
  style={lp.hostBtnPrimary}
  onPress={() => router.push({ pathname: "/(playon-pro)/create-league", params: { hostType: "managed" } } as any)}
  activeOpacity={0.85}
>
  <Ionicons name="add-circle-outline" size={16} color="#fff" />
  <Text style={lp.hostBtnPrimaryTxt}>Create a League</Text>
</TouchableOpacity>
<TouchableOpacity
  style={lp.hostBtnSecondary}
  onPress={() => router.push("/(playon-pro)/my-league" as any)}
  activeOpacity={0.85}
>
  <Ionicons name="megaphone-outline" size={16} color="#7C3AED" />
  <Text style={lp.hostBtnSecondaryTxt}>manage a League</Text>
</TouchableOpacity>
          
            </View>
          </View>
        </View>

        {/* ── Cricket style row ── */}
        {isCricket && (profile.battingHand || profile.bowlingStyle) && (
          <View style={lp.section}>
            <Text style={lp.sectionTitle}>Playing Style</Text>
            <View style={lp.styleRow}>
              {!!profile.battingHand && (
                <View style={lp.stylePill}>
                  <Ionicons name="hand-left-outline" size={14} color="#7C3AED" />
                  <Text style={lp.stylePillTxt}>{profile.battingHand} Bat</Text>
                </View>
              )}
              {!!profile.bowlingStyle && profile.bowlingStyle !== "Does Not Bowl" && (
                <View style={lp.stylePill}>
                  <Ionicons name="baseball-outline" size={14} color="#7C3AED" />
                  <Text style={lp.stylePillTxt}>{profile.bowlingStyle}</Text>
                </View>
              )}
              {profile.sports?.map((sp) => (
                <View key={sp} style={[lp.stylePill, { backgroundColor: "#EDE9FE", borderColor: "#C4B5FD" }]}>
                  <Text style={[lp.stylePillTxt, { color: "#5B21B6" }]}>{sp}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── League history ── */}
        <View style={lp.section}>
          <Text style={lp.sectionTitle}>League History</Text>
          <View style={lp.historyEmpty}>
            <Ionicons name="trophy-outline" size={22} color="#D1D5DB" />
            <Text style={lp.historyEmptyTxt}>No leagues played yet</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// LiveProfile styles
const lp = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F8F9FB" },

  // Top bar
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 8 : 8,
    paddingBottom: 10, backgroundColor: "#F8F9FB",
  },
  topLogo:    { fontSize: 20, fontWeight: "900", letterSpacing: -0.5 },
  topIcons:   { flexDirection: "row", gap: 8 },
  topIconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E5E7EB", position: "relative" },
  notifDot:   { position: "absolute", top: 8, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: "#7C3AED", borderWidth: 1.5, borderColor: "#F8F9FB" },

  // Profile card
  profileCard: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 16, marginBottom: 14,
    backgroundColor: "#fff", borderRadius: 18,
    padding: 14, gap: 12,
    borderWidth: 1, borderColor: "#F3F4F6",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  avatarWrap: { position: "relative", flexShrink: 0 },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: "#7C3AED",
    alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: "#EDE9FE",
  },
  avatarTxt:  { color: "#fff", fontWeight: "900", fontSize: 24 },
  editDot: {
    position: "absolute", bottom: 2, right: 2,
    width: 22, height: 22, borderRadius: 11, backgroundColor: "#7C3AED",
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff",
  },
  profileMeta: { flex: 1, gap: 2 },
  nameRow:     { flexDirection: "row", alignItems: "center", gap: 6 },
  profileName: { fontSize: 17, fontWeight: "800", color: "#0F172A", flex: 1 },
  profileHandle:{ fontSize: 13, color: "#6B7280", fontWeight: "500" },
  profileLocation:{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  profileLocationTxt:{ fontSize: 12, color: "#6B7280" },
  editBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7, alignSelf: "flex-start",
    backgroundColor: "#F9FAFB",
  },
  editBtnTxt: { fontSize: 12, fontWeight: "600", color: "#374151" },

  // 4-stat bar
  statBar: {
    flexDirection: "row",
    marginHorizontal: 16, marginBottom: 14,
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: "#F3F4F6",
    overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  statCell:       { flex: 1, alignItems: "center", paddingVertical: 16, gap: 5 },
  statCellBorder: { borderRightWidth: 1, borderRightColor: "#F3F4F6" },
  statIconWrap:   { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statCellLabel:  { fontSize: 11, color: "#6B7280", fontWeight: "500" },
  statCellValue:  { fontSize: 20, fontWeight: "900", color: "#0F172A" },

  // Sections
  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle:  { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  seasonBtn:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: "#F3F4F6" },
  seasonBtnTxt:  { fontSize: 12, fontWeight: "600", color: "#6B7280" },

  // Performance grid
  perfGrid: {
    flexDirection: "row", flexWrap: "wrap",
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: "#F3F4F6", overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  perfCell:       { width: "50%", paddingVertical: 18, paddingHorizontal: 20 },
  perfCellRight:  { borderRightWidth: 1, borderRightColor: "#F3F4F6" },
  perfCellBottom: { borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  perfLabel:      { fontSize: 12, color: "#9CA3AF", fontWeight: "500", marginBottom: 6 },
  perfValue:      { fontSize: 22, fontWeight: "800", color: "#0F172A" },

  // Achievements
  achScroll: { gap: 12, paddingBottom: 4, paddingTop: 2 },
  achCard: {
    width: 148, backgroundColor: "#fff", borderRadius: 16,
    padding: 14, gap: 6,
    borderWidth: 1, borderColor: "#F3F4F6",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  achIconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  achTitle:    { fontSize: 14, fontWeight: "700", color: "#0F172A" },
  achSub:      { fontSize: 12, color: "#9CA3AF" },
  achValue:    { fontSize: 16, fontWeight: "800", marginTop: 2 },

  // Run-a-league card — NEW
  hostCard: {
    backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#F3F4F6",
    padding: 16, alignItems: "flex-start",
    shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  hostIconWrap: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: "#EDE9FE",
    alignItems: "center", justifyContent: "center", marginBottom: 10,
  },
  hostTitle: { fontSize: 16, fontWeight: "800", color: "#0F172A", marginBottom: 4 },
  hostSub:   { fontSize: 13, color: "#6B7280", lineHeight: 19, marginBottom: 14 },
  hostBtnRow: { flexDirection: "row", gap: 10, width: "100%" },
  hostBtnPrimary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#7C3AED", borderRadius: 12, paddingVertical: 12,
  },
  hostBtnPrimaryTxt: { color: "#fff", fontSize: 13, fontWeight: "700" },
  hostBtnSecondary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#EDE9FE", borderRadius: 12, paddingVertical: 12,
  },
  hostBtnSecondaryTxt: { color: "#5B21B6", fontSize: 13, fontWeight: "700" },

  // Playing style
  styleRow:  { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stylePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#F3F4F6", borderColor: "#E5E7EB", borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  stylePillTxt: { fontSize: 13, fontWeight: "600", color: "#374151" },

  // League history empty
  historyEmpty: {
    alignItems: "center", paddingVertical: 32,
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: "#F3F4F6", gap: 8,
  },
  historyEmptyTxt: { fontSize: 13, color: "#9CA3AF" },
});

// =============================================================================
// EXPIRY BADGE — shown on live profile header
// =============================================================================
function ExpiryBadge({ expiresAt }: { expiresAt: any }) {
  if (!expiresAt) return null;
  const expDate  = expiresAt?.toDate ? expiresAt.toDate() : new Date(expiresAt);
  const now      = new Date();
  const daysLeft = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft > 60) return null; // no badge needed if plenty of time

  const color = daysLeft <= 0 ? "#DC2626" : daysLeft <= 14 ? "#D97706" : "#059669";
  const bg    = daysLeft <= 0 ? "#FEF2F2" : daysLeft <= 14 ? "#FFFBEB" : "#F0FDF4";
  const label = daysLeft <= 0
    ? "Expired"
    : daysLeft === 1
    ? "Expires tomorrow"
    : `Expires in ${daysLeft} days`;

  return (
    <View style={[eb.wrap, { backgroundColor: bg, borderColor: color + "44" }]}>
      <Ionicons name="time-outline" size={12} color={color} />
      <Text style={[eb.txt, { color }]}>{label}</Text>
    </View>
  );
}
const eb = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  txt:  { fontSize: 12, fontWeight: "700" },
});

// =============================================================================
// RENEW PROMPT — shows inside LiveProfile when <30 days left
// =============================================================================
function RenewPrompt({ expiresAt, renewalFee, onRenew, renewing }: {
  expiresAt: any; renewalFee: number; onRenew: () => void; renewing: boolean;
}) {
  if (!expiresAt) return null;
  const expDate  = expiresAt?.toDate ? expiresAt.toDate() : new Date(expiresAt);
  const daysLeft = Math.ceil((expDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft > 30) return null; // only show when 30 days or less

  const isExpired = daysLeft <= 0;
  const feeLabel  = renewalFee > 0 ? `₹${renewalFee.toLocaleString("en-IN")}` : "Free";

  return (
    <View style={rp.wrap}>
      <View style={rp.left}>
        <Ionicons name={isExpired ? "warning-outline" : "refresh-circle-outline"} size={20}
          color={isExpired ? "#DC2626" : "#D97706"} />
        <View>
          <Text style={[rp.title, { color: isExpired ? "#DC2626" : "#92400E" }]}>
            {isExpired ? "Profile expired" : "Renewal coming up"}
          </Text>
          <Text style={rp.sub}>
            {isExpired
              ? "Renew now to keep your stats and ID."
              : `Renew before it expires to avoid losing access.`}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={[rp.btn, renewing && { opacity: 0.6 }]}
        onPress={onRenew} disabled={renewing}
      >
        {renewing
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text style={rp.btnTxt}>{feeLabel === "Free" ? "Renew Free" : `Renew ${feeLabel}`}</Text>
        }
      </TouchableOpacity>
    </View>
  );
}
const rp = StyleSheet.create({
  wrap:   { marginHorizontal: 16, marginBottom: 10, backgroundColor: "#FFFBEB", borderColor: "#FDE68A", borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  left:   { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  title:  { fontSize: 13, fontWeight: "800", marginBottom: 2 },
  sub:    { fontSize: 12, color: "#6B7280", lineHeight: 17 },
  btn:    { backgroundColor: "#D97706", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  btnTxt: { color: "#fff", fontSize: 13, fontWeight: "800" },
});

// =============================================================================
// RENEWAL GATE — shown when profile.isExpired === true
// Full screen with expired state + pay to renew
// =============================================================================
function RenewalGate({ profile, userName, userPhone, renewalFee, renewing, onRenew }: {
  profile: PlayerProfile; userName: string; userPhone: string;
  renewalFee: number; renewing: boolean; onRenew: () => void;
}) {
  const expDate = profile.expiresAt?.toDate
    ? profile.expiresAt.toDate()
    : profile.expiresAt ? new Date(profile.expiresAt) : null;
  const expiredOnStr = expDate
    ? expDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "Unknown";

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Greyed-out profile header */}
        <View style={s.head}>
          <View style={[s.avatar, { backgroundColor: "#9CA3AF" }]}>
            <Text style={s.avatarTxt}>{getInitials(profile.displayName || userName)}</Text>
          </View>
          <Text style={s.name}>{profile.displayName || userName}</Text>
          <View style={s.playonIdRow}>
            <Text style={[s.playonIdAt, { color: "#9CA3AF" }]}>@</Text>
            <Text style={[s.playonId,   { color: "#9CA3AF" }]}>{profile.playonId}</Text>
          </View>
          {!!userPhone && <Text style={s.phone}>{userPhone}</Text>}
          <View style={[s.tierBadge, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5", borderWidth: 1 }]}>
            <Ionicons name="close-circle-outline" size={12} color="#DC2626" />
            <Text style={[s.tierTxt, { color: "#DC2626" }]}>Expired</Text>
          </View>
        </View>

        {/* Expired notice */}
        <View style={rg.expiredBox}>
          <Ionicons name="warning-outline" size={24} color="#DC2626" />
          <Text style={rg.expiredTitle}>Your Playon Pro expired</Text>
          <Text style={rg.expiredSub}>
            Your profile expired on {expiredOnStr}. Renew now to restore access to your stats,
            league history and @{profile.playonId} identity. Your stats are safely stored and
            will be visible again the moment you renew.
          </Text>
        </View>

        {/* Renewal card */}
        <View style={rg.renewCard}>
          <View style={rg.renewGlow} />
          <View style={rg.renewTop}>
            <View style={s.unlockBadge}>
              <Ionicons name="refresh-circle-outline" size={16} color="#15803D" />
              <Text style={s.unlockBadgeTxt}>Annual Renewal</Text>
            </View>
            {renewalFee > 0 && (
              <Text style={s.unlockPrice}>₹{renewalFee.toLocaleString("en-IN")}/yr</Text>
            )}
          </View>

          <Text style={rg.renewTitle}>Renew your Playon ID</Text>
          <Text style={rg.renewSub}>
            Keep your @{profile.playonId} · All your stats stay intact · Active for 12 months from today
          </Text>

          {[
            { icon: "shield-checkmark-outline", text: "Same @PlayonID — nothing changes" },
            { icon: "stats-chart-outline",      text: "All your match stats and league history restored" },
            { icon: "calendar-outline",         text: "Active for 12 months from renewal date" },
          ].map((f) => (
            <View key={f.text} style={s.featureRow}>
              <View style={s.featureDot}><Ionicons name={f.icon as any} size={14} color={GREEN} /></View>
              <Text style={s.featureTxt}>{f.text}</Text>
            </View>
          ))}

          <TouchableOpacity
            style={[s.unlockBtn, renewing && { opacity: 0.6 }]}
            onPress={onRenew} disabled={renewing} activeOpacity={0.85}
          >
            {renewing
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Ionicons name="refresh-circle-outline" size={16} color="#fff" />
                  <Text style={s.unlockBtnTxt}>
                    {renewalFee > 0
                      ? `Renew for ₹${renewalFee.toLocaleString("en-IN")}`
                      : "Renew — Free"}
                  </Text>
                </>
            }
          </TouchableOpacity>
          {renewalFee > 0 && <Text style={s.oneTimeNote}>Yearly subscription · Renews your profile for 12 months</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const rg = StyleSheet.create({
  expiredBox: {
    margin: 16, backgroundColor: "#FEF2F2", borderColor: "#FCA5A5",
    borderWidth: 1, borderRadius: 14, padding: 16, alignItems: "center", gap: 8,
  },
  expiredTitle: { fontSize: 16, fontWeight: "800", color: "#DC2626" },
  expiredSub:   { fontSize: 13, color: "#6B7280", textAlign: "center", lineHeight: 20 },
  renewCard: {
    marginHorizontal: 16, marginTop: 6, backgroundColor: "#fff",
    borderColor: "#D1FAE5", borderWidth: 1.5, borderRadius: 18,
    padding: 18, overflow: "hidden",
    shadowColor: "#16A34A", shadowOpacity: 0.08, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  renewGlow: {
    position: "absolute", top: 0, left: 0, right: 0, height: 4,
    backgroundColor: GREEN, borderTopLeftRadius: 18, borderTopRightRadius: 18,
  },
  renewTop:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  renewTitle:{ fontSize: 17, fontWeight: "800", color: DARK, marginBottom: 6 },
  renewSub:  { fontSize: 13, color: "#4B5563", lineHeight: 20, marginBottom: 14 },
});

// =============================================================================
// STYLES
// =============================================================================
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#fff" },
  center: { alignItems: "center", justifyContent: "center" },

  head: {
    alignItems: "center",
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 24 : 24,
    paddingBottom: 18, paddingHorizontal: 20,
  },
  avatar: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: GREEN,
    alignItems: "center", justifyContent: "center", marginBottom: 10,
  },
  avatarTxt: { color: "#fff", fontSize: 30, fontWeight: "800" },
  name:    { fontSize: 20, fontWeight: "800", color: DARK, marginTop: 2 },
  phone:   { fontSize: 13, color: "#6B7280", marginTop: 2 },
  ageTxt:  { fontSize: 13, color: "#6B7280", marginTop: 2 },
  bio:     { fontSize: 13, color: "#4B5563", marginTop: 6, textAlign: "center", lineHeight: 19 },

  playonIdRow: { flexDirection: "row", alignItems: "center", marginTop: 5 },
  playonIdAt:  { fontSize: 16, fontWeight: "700", color: GREEN },
  playonId:    { fontSize: 16, fontWeight: "700", color: GREEN },

  metaRow:     { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 8 },
  metaPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#F3F4F6", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  metaPillTxt: { fontSize: 12, color: "#4B5563", fontWeight: "600" },

  sportsChipsRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 8 },
  sportChip: {
    backgroundColor: "#F0FDF4", borderColor: "#BBF7D0", borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  sportChipTxt: { fontSize: 12, fontWeight: "600", color: "#15803D" },

  tierBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8,
    backgroundColor: "#F3F4F6", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  tierTxt: { fontSize: 12, fontWeight: "600", color: "#6B7280" },

  statsRow:  { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginTop: 6 },
  statTile: {
    flex: 1, backgroundColor: "#F9FAFB", borderColor: "#F3F4F6", borderWidth: 1,
    borderRadius: 14, paddingVertical: 16, alignItems: "center",
  },
  statValue: { fontSize: 22, fontWeight: "800", color: "#15803D" },
  statLabel: { fontSize: 12, color: "#6B7280", marginTop: 2 },

  section:      { paddingHorizontal: 16, marginTop: 22 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: "#111827", marginBottom: 10 },
  historyEmpty: { alignItems: "center", paddingVertical: 28, backgroundColor: "#F9FAFB", borderRadius: 12, gap: 8 },
  historyEmptyTxt: { fontSize: 13, color: "#9CA3AF" },

  // Unlock card — redesigned, no pricing
  unlockCard: {
    marginHorizontal: 16, marginTop: 22, backgroundColor: "#fff",
    borderColor: "#D1FAE5", borderWidth: 1.5, borderRadius: 18, padding: 18,
    overflow: "hidden",
    shadowColor: "#16A34A", shadowOpacity: 0.08, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  unlockGlow: {
    position: "absolute", top: 0, left: 0, right: 0, height: 4,
    backgroundColor: GREEN, borderTopLeftRadius: 18, borderTopRightRadius: 18,
  },
  unlockTop:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  unlockBadge:   {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#DCFCE7", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  unlockBadgeTxt: { fontSize: 12, fontWeight: "800", color: "#15803D" },
  freeTag:        { backgroundColor: "#DCFCE7", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  freeTagTxt:     { fontSize: 12, fontWeight: "800", color: "#15803D" },
  unlockPrice:    { fontSize: 22, fontWeight: "900", color: DARK },
  unlockTitle:    { fontSize: 17, fontWeight: "800", color: DARK, marginBottom: 6 },
  unlockSub:      { fontSize: 13, color: "#4B5563", lineHeight: 20, marginBottom: 14 },
  featureRow:     { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  featureDot: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: "#F0FDF4",
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  featureTxt:   { flex: 1, fontSize: 13, color: "#374151", lineHeight: 20 },
  unlockBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GREEN, borderRadius: 14, paddingVertical: 15, marginTop: 16,
  },
  unlockBtnTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
  oneTimeNote:  { fontSize: 11, color: "#9CA3AF", textAlign: "center", marginTop: 8 },
});

// Modal styles
const m = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, maxHeight: "92%",
  },
  handle:      { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 14 },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  headerTitle: { fontSize: 17, fontWeight: "800", color: DARK },

  label:       { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 16 },
  sublabel:    { fontSize: 11, color: "#9CA3AF", marginBottom: 8, marginTop: -4 },
  optionalTag: { fontSize: 12, fontWeight: "400", color: "#9CA3AF" },

  idRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  atSign:  { fontSize: 20, fontWeight: "800", color: GREEN, paddingBottom: 2 },
  idInput: {
    flex: 1, height: 48, backgroundColor: "#F9FAFB",
    borderColor: "#E5E7EB", borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 14, fontSize: 16, fontWeight: "700", color: DARK,
  },
  idStatus: { width: 22 },
  idError:  { fontSize: 12, color: "#EF4444", marginTop: 4 },
  idHint:   { fontSize: 11, color: "#9CA3AF", marginTop: 4, lineHeight: 16 },

  chipsWrap:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip:          { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  chipActive:    { backgroundColor: "#DCFCE7", borderColor: "#16A34A" },
  chipTxt:       { fontSize: 13, color: "#6B7280", fontWeight: "600" },
  chipTxtActive: { color: "#15803D", fontWeight: "700" },

  ageInput: {
    height: 48, width: 100, backgroundColor: "#F9FAFB",
    borderColor: "#E5E7EB", borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 14, fontSize: 16, fontWeight: "700", color: DARK,
  },
  bioInput: {
    height: 72, backgroundColor: "#F9FAFB",
    borderColor: "#E5E7EB", borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 14, paddingTop: 12,
    fontSize: 13, color: DARK, textAlignVertical: "top",
  },
  bioCount: { fontSize: 11, color: "#9CA3AF", textAlign: "right", marginTop: 3 },

  feeBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginTop: 16, backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0", borderWidth: 1, borderRadius: 12, padding: 12,
  },
  feeTxt:  { fontSize: 13, color: "#15803D", fontWeight: "600" },
  feeHint: { fontSize: 11, color: "#15803D", opacity: 0.75, marginTop: 2 },

  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GREEN, borderRadius: 14, paddingVertical: 16, marginTop: 20,
  },
  submitTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
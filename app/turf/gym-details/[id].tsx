import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Platform,
  Image,
  Linking,
  Alert,
  Modal,
  FlatList,
  Dimensions,
  TextInput,
  Keyboard,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "../../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import RazorpayCheckout from "react-native-razorpay";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const HERO_H = 300;

// ─── Tokens ─────────────────────────────────────────────────────────────────
const DARK   = "#0B1220";
const GYM    = "#7C3AED"; // gym accent
const TINT   = "#F4F0FF"; // soft purple tint for icon wells / selected cards
const BORDER = "#ECECF1";
const MUTED  = "#9CA3AF";
const INK    = "#1A1D21";

const FALLBACK_IMG =
  "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=900&q=80";

// ─── Amenity → Ionicon map ────────────────────────────────────────────────────
const AMENITY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  "Cardio Zone":      "walk-outline",
  "Free Weights":     "barbell-outline",
  "Machines":         "cog-outline",
  "Personal Trainer": "person-outline",
  "Steam / Sauna":    "flame-outline",
  "Locker Room":      "lock-closed-outline",
  "Showers":          "rainy-outline",
  "Parking":          "car-outline",
  "Drinking Water":   "water-outline",
  "WiFi":             "wifi-outline",
  "Air Conditioned":  "snow-outline",
  "Yoga / Zumba":     "body-outline",
};

// ─── Batch icon (morning/evening/night feel) ─────────────────────────────────
const batchIcon = (label: string): keyof typeof Ionicons.glyphMap => {
  const l = label.toLowerCase();
  if (l.includes("morning")) return "sunny-outline";
  if (l.includes("after"))   return "partly-sunny-outline";
  if (l.includes("even"))    return "cloudy-night-outline";
  if (l.includes("night"))   return "moon-outline";
  return "time-outline";
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
const getImages = (g: any): string[] => {
  const arr = Array.isArray(g?.images) ? g.images.filter(Boolean) : [];
  if (arr.length > 0) return Array.from(new Set(arr));
  if (g?.image) return [g.image];
  return [FALLBACK_IMG];
};

// Normalise gym.batches → [{ label, time }]. Handles strings OR objects.
const getBatches = (g: any): { label: string; time: string }[] => {
  const raw = Array.isArray(g?.batches) ? g.batches : [];
  return raw
    .map((b: any) => {
      if (typeof b === "string") return { label: b, time: "" };
      if (b && typeof b === "object") {
        const label = b.label || b.name || "";
        const time =
          b.time ||
          (b.from && b.to ? `${b.from} - ${b.to}` : b.from || b.to || "");
        return { label, time };
      }
      return null;
    })
    .filter((b: any) => b && b.label) as { label: string; time: string }[];
};

function fmtHour(h: number): string {
  if (h == null || isNaN(h)) return "";
  const hh = ((h % 24) + 24) % 24;
  const period = hh < 12 ? "AM" : "PM";
  const display = hh % 12 === 0 ? 12 : hh % 12;
  return `${display}:00 ${period}`;
}

const perMonth = (p: any): number =>
  p.months > 0 ? Math.round(p.price / p.months) : p.price;

const savingsPct = (p: any): number | null =>
  p.strikePrice && p.strikePrice > p.price
    ? Math.round((1 - p.price / p.strikePrice) * 100)
    : null;

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function GymDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [gym, setGym]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  // ── Hero carousel + lightbox state ──
  const [heroIndex, setHeroIndex]     = useState(0);
  const [viewerOpen, setViewerOpen]   = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // ── Booking sheet state ──
  const [sheetOpen, setSheetOpen]   = useState(false);
  const [kbHeight, setKbHeight]     = useState(0);
  const [custName, setCustName]     = useState("");
  const [custPhone, setCustPhone]   = useState("");
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);

  // ── Promo state ──
  const [promoInput, setPromoInput]   = useState("");
  const [promoLoading, setPromoLoad]  = useState(false);
  const [promoError, setPromoError]   = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<any>(null); // { promoId, code, discount, finalOnlineAmount, description }

  useEffect(() => { loadGym(); }, []);

  // Track the real keyboard height so we can lift the sheet ourselves.
  // (Android transparent Modals ignore windowSoftInputMode, so KeyboardAvoidingView
  //  and the app.json pan setting don't reach this sheet — manual tracking is reliable.)
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = (e: any) => setKbHeight(e?.endCoordinates?.height ?? 0);
    const onHide = () => setKbHeight(0);
    const s = Keyboard.addListener(showEvt, onShow);
    const h = Keyboard.addListener(hideEvt, onHide);
    return () => { s.remove(); h.remove(); };
  }, []);

 const loadGym = async () => {
  try {
    const snap = await getDoc(doc(db, "turfs", String(id)));  // ✅ NEW: read from turfs collection
    if (snap.exists()) {
      const data = { id: snap.id, ...snap.data() } as any;
      
      // ✅ Safety check: make sure this is actually a gym
      if (data.venueType !== "gym") {
        Alert.alert(
          "Wrong page", 
          "This venue isn't a gym. Redirecting...",
          [{ text: "OK", onPress: () => router.replace(`/turf/${id}`) }]
        );
        return;
      }
      
      setGym(data);
    }
  } catch (e) { console.log(e); }
  finally { setLoading(false); }
};

  const images = useMemo(() => getImages(gym), [gym]);
  const batches = useMemo(() => getBatches(gym), [gym]);

  const plans = useMemo(() => {
    const p = Array.isArray(gym?.plans) ? [...gym.plans] : [];
    return p.sort((a, b) => (a.months ?? 0) - (b.months ?? 0));
  }, [gym]);

  const bestValueId = useMemo(() => {
    if (plans.length === 0) return null;
    return plans.reduce((best, p) => (perMonth(p) < perMonth(best) ? p : best), plans[0]).id;
  }, [plans]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) || null;

  // amount math for the sheet
  const baseAmount  = selectedPlan ? Number(selectedPlan.price) : 0;
  const discount    = appliedPromo ? Number(appliedPromo.discount) : 0;
  const finalAmount = Math.max(baseAmount - discount, 0);

  // ── Carousel paging ──
  const onHeroScroll = (e: any) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (i !== heroIndex) setHeroIndex(i);
  };
  const onViewerScroll = (e: any) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (i !== viewerIndex) setViewerIndex(i);
  };
  const openViewer = (index: number) => { setViewerIndex(index); setViewerOpen(true); };

  const openMaps = () => {
    if (!gym?.mapLink) return;
    Linking.openURL(gym.mapLink).catch(() =>
      Alert.alert("Error", "Couldn't open the map link.")
    );
  };

 const contactGym = () => {
  // ✅ Try new fields first (from updated add-gym.tsx), fall back to old fields
  const phone = String(
    gym?.gymPhone ||         // ← NEW field from add-gym.tsx
    gym?.contactPhone || 
    gym?.phone || 
    gym?.ownerPhone || 
    ""
  ).replace(/\s/g, "");
  
  const whatsappNumber = String(
    gym?.gymWhatsapp ||       // ← NEW field, falls back to phone
    gym?.gymPhone ||
    phone
  ).replace(/\s/g, "");

  const email = gym?.gymEmail || gym?.ownerEmail || "";  // ← NEW + fallback
  const ownerName = gym?.ownerName || "the gym";

  const buttons: any[] = [];
  if (phone) {
    buttons.push({ text: "Call", onPress: () => Linking.openURL(`tel:${phone}`) });
    buttons.push({
      text: "WhatsApp",
      onPress: () => {
        const num = whatsappNumber.replace(/\D/g, "");
        const wa = num.length === 10 ? `91${num}` : num;
        Linking.openURL(
          `https://wa.me/${wa}?text=${encodeURIComponent(`Hi, I'm interested in a membership at ${gym.name}.`)}`
        ).catch(() => Alert.alert("WhatsApp not installed", `Call ${phone} instead.`));
      },
    });
  }
  buttons.push({ text: "Close", style: "cancel" });

  const message = phone
    ? `${gym.name}\n\nFor membership details & joining, contact:\n\n📞 ${phone}  ${gym.location ? `\n📍 ${gym.location}` : ""}`
    : `${gym.name}\n\nNo contact number added yet. Add one from the Add Gym screen.`;

  Alert.alert("Booking coming soon", message, buttons);
};

  // ── Step 1: open the booking sheet (was: go straight to Razorpay) ──
  const openBookingSheet = () => {
    if (!auth.currentUser) {
      Alert.alert("Login required", "Please log in to buy a membership.", [
        { text: "Cancel", style: "cancel" },
        { text: "Log In", onPress: () => router.push("/(auth)/login") },
      ]);
      return;
    }
    if (!selectedPlan) {
      Alert.alert("Select a plan", "Please choose a membership plan first.");
      return;
    }
    // prefill name from the logged-in account (editable — could be for someone else)
    if (!custName) setCustName(auth.currentUser.displayName || "");
    // single batch → auto-select it
    if (!selectedBatch && batches.length === 1) setSelectedBatch(batches[0].label);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    if (paying || promoLoading) return;
    Keyboard.dismiss();
    setSheetOpen(false);
  };

  // ── Promo apply / remove ──
  const applyPromo = async () => {
    const code = promoInput.trim();
    if (!code || !selectedPlan || !auth.currentUser) return;
    try {
      setPromoLoad(true);
      setPromoError(null);
      const res = await fetch(`${SERVER_URL}/validate-promo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          userId: auth.currentUser.uid,
          turfId: gym.id,            // gyms reuse the turfId field; keep applicableTurfs open or include this id
          onlineAmount: baseAmount,  // membership = full online payment
          bookingType: "full",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAppliedPromo(null);
        setPromoError(data.error || "Couldn't apply this code.");
        return;
      }
      setAppliedPromo(data);
      setPromoError(null);
    } catch (e: any) {
      setAppliedPromo(null);
      setPromoError("Network error. Please try again.");
    } finally {
      setPromoLoad(false);
    }
  };

  const removePromo = () => {
    setAppliedPromo(null);
    setPromoInput("");
    setPromoError(null);
  };

  // ── Step 2: confirm → create order → Razorpay → verify ──
  const confirmAndPay = async () => {
    if (!auth.currentUser || !selectedPlan) return;

    if (!custName.trim()) {
      Alert.alert("Name required", "Please enter the member's name.");
      return;
    }
    if (batches.length > 0 && !selectedBatch) {
      Alert.alert("Select a batch", "Please pick a training batch.");
      return;
    }
    if (custPhone.trim() && custPhone.trim().replace(/\D/g, "").length < 10) {
      Alert.alert("Check phone", "Please enter a valid 10-digit phone number, or leave it blank.");
      return;
    }

    try {
      setPaying(true);
      const userId = auth.currentUser.uid;

      // 1) Create the order on the server.
      //    The server sources price from the gym doc AND must re-validate the promo
      //    server-side (never trust a client discount). We only pass promoId/code.
      const orderRes = await fetch(`${SERVER_URL}/create-gym-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gymId: gym.id,
          planId: selectedPlan.id,
          userId,
          customerName: custName.trim(),
          customerPhone: custPhone.trim() || null,
          batch: selectedBatch || null,
          promoId: appliedPromo?.promoId || null,
          promoCode: appliedPromo?.code || null,
        }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok || !order.orderId) {
        throw new Error(order.error || "Could not start payment.");
      }

      // 2) Open Razorpay checkout (amount comes from the server, post-discount)
      const options = {
        key:        order.key,
        order_id:   order.orderId,
        amount:     order.amount,            // paise, authoritative from server
        currency:   order.currency || "INR",
        name:       gym.name,
        description: `${selectedPlan.label} membership`,
        image:      images[0],
        prefill: {
          email:   auth.currentUser.email || "",
          name:    custName.trim(),
          contact: custPhone.trim(),
        },
        theme: { color: GYM },
      };

      const payment = await RazorpayCheckout.open(options);

      // 3) Verify on the server → writes the membership doc
      const verifyRes = await fetch(`${SERVER_URL}/verify-gym-payment`, {
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
        setSheetOpen(false);
        Alert.alert(
          "Membership Active 🎉",
          `${custName.trim()}'s ${selectedPlan.label} membership at ${gym.name} is now active.`,
          [{ text: "Done", onPress: () => router.back() }],
        );
      } else {
        throw new Error(verify.error || "Payment verification failed.");
      }
    } catch (e: any) {
      const dismissed = e?.code === 0 || /cancel|dismiss/i.test(e?.description || "");
      if (dismissed) return;
      Alert.alert(
        "Payment issue",
        e?.message || e?.description || "Something went wrong. If money was deducted it will be auto-refunded.",
      );
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={GYM} />
      </View>
    );
  }

  if (!gym) {
    return (
      <View style={styles.loadingWrap}>
        <Ionicons name="alert-circle-outline" size={40} color={MUTED} />
        <Text style={styles.notFoundText}>Gym not found</Text>
      </View>
    );
  }

  const amenities: string[] = Array.isArray(gym.amenities) ? gym.amenities : [];
  const rating = parseFloat(gym.rating);
  const ratingLabel = !isNaN(rating) && rating > 0 ? rating.toFixed(1) : "New";
  const hasMultiple = images.length > 1;
  const barBottomPad = Math.max(insets.bottom, 12) + 6;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 150 + insets.bottom }}
      >
        {/* ── Hero carousel ── */}
        <View style={styles.hero}>
          <ScrollView
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onHeroScroll}
          >
            {images.map((uri, i) => (
              <TouchableOpacity key={`${uri}-${i}`} activeOpacity={0.95} onPress={() => openViewer(i)}>
                <Image source={{ uri }} style={styles.heroImg} resizeMode="cover" />
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.heroOverlay} pointerEvents="none" />

          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.85}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>

          <View style={styles.gymBadge}>
            <Ionicons name="barbell" size={12} color="#fff" />
            <Text style={styles.gymBadgeTxt}>GYM</Text>
          </View>

          {hasMultiple && (
            <View style={styles.countPill}>
              <Ionicons name="images-outline" size={13} color="#fff" />
              <Text style={styles.countPillTxt}>{heroIndex + 1}/{images.length}</Text>
            </View>
          )}

          {hasMultiple && (
            <View style={styles.heroDots} pointerEvents="none">
              {images.map((_, i) => (
                <View key={i} style={[styles.heroDot, i === heroIndex && styles.heroDotActive]} />
              ))}
            </View>
          )}

          <View style={styles.heroBottom} pointerEvents="none">
            <Text style={styles.heroName} numberOfLines={2}>{gym.name}</Text>
            <View style={styles.heroLocRow}>
              <Ionicons name="location-outline" size={14} color="rgba(255,255,255,0.85)" />
              <Text style={styles.heroLocTxt} numberOfLines={1}>{gym.location || "—"}</Text>
            </View>
          </View>
        </View>

        {/* ── Quick stats ── */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <View style={styles.statIconWell}><Ionicons name="star" size={16} color={GYM} /></View>
            <Text style={styles.statValue}>{ratingLabel}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
  <View style={styles.statIconWell}><Ionicons name="time-outline" size={16} color={GYM} /></View>
  <Text style={styles.statValue} numberOfLines={1}>
    {gym.splitSessions 
      ? `${fmtHour(gym.morningOpen)}` 
      : gym.openingTime != null 
        ? fmtHour(gym.openingTime) 
        : "—"}
  </Text>
  <Text style={styles.statLabel}>
    {gym.splitSessions ? "Morning" : "Opens"}
  </Text>
</View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <View style={styles.statIconWell}><Ionicons name="pricetags-outline" size={16} color={GYM} /></View>
            <Text style={styles.statValue}>{plans.length}</Text>
            <Text style={styles.statLabel}>Plans</Text>
          </View>
        </View>

        {/* ── Amenities ── */}
        {amenities.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>What's inside</Text>
            <Text style={styles.sectionSub}>Facilities available at this gym</Text>
            <View style={styles.amenityGrid}>
              {amenities.map((a) => (
                <View key={a} style={styles.amenityCard}>
                  <View style={styles.amenityIconWell}>
                    <Ionicons name={AMENITY_ICON[a] || "checkmark-circle-outline"} size={18} color={GYM} />
                  </View>
                  <Text style={styles.amenityTxt} numberOfLines={2}>{a}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

      

    {/* ── Operating Hours (split sessions or continuous) ── */}
<View style={styles.section}>
  <Text style={styles.sectionTitle}>Operating Hours</Text>
  <Text style={styles.sectionSub}>
    {gym.splitSessions ? "Morning & evening sessions" : "Open continuously"}
  </Text>

  {gym.splitSessions ? (
    <View style={{ gap: 10 }}>
      {/* Morning session */}
      <View style={styles.locCard}>
        <View style={styles.locIcon}>
          <Ionicons name="sunny-outline" size={20} color={GYM} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: INK }}>Morning Session</Text>
          <Text style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {fmtHour(gym.morningOpen)} — {fmtHour(gym.morningClose)}
          </Text>
        </View>
      </View>

      {/* Evening session */}
      <View style={styles.locCard}>
        <View style={styles.locIcon}>
          <Ionicons name="moon-outline" size={20} color={GYM} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: INK }}>Evening Session</Text>
          <Text style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {fmtHour(gym.eveningOpen)} — {fmtHour(gym.eveningClose)}
          </Text>
        </View>
      </View>
    </View>
  ) : (
    <View style={styles.locCard}>
      <View style={styles.locIcon}>
        <Ionicons name="time-outline" size={20} color={GYM} />
      </View>
      <Text style={styles.locText}>
        {gym.openingTime != null && gym.closingTime != null
          ? `${fmtHour(gym.openingTime)} — ${fmtHour(gym.closingTime)}`
          : "Hours not set"}
      </Text>
    </View>
  )}
</View>
        {/* ── Membership plans ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Membership Plans</Text>
          <Text style={styles.sectionSub}>Pick the plan that suits you</Text>

          {plans.length === 0 ? (
            <View style={styles.emptyPlans}>
              <Ionicons name="pricetags-outline" size={24} color={MUTED} />
              <Text style={styles.emptyPlansTxt}>No plans listed yet.</Text>
            </View>
          ) : (
            plans.map((p) => {
              const sel  = p.id === selectedPlanId;
              const save = savingsPct(p);
              const best = p.id === bestValueId && plans.length > 1;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.planCard, sel && styles.planCardSel]}
                  activeOpacity={0.9}
                  onPress={() => setSelectedPlanId(p.id)}
                >
                  {best && (
                    <View style={styles.bestRibbon}>
                      <Ionicons name="sparkles" size={9} color="#fff" />
                      <Text style={styles.bestRibbonTxt}>BEST VALUE</Text>
                    </View>
                  )}
                  <View style={[styles.radio, sel && styles.radioSel]}>
                    {sel && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.planLabel, sel && { color: GYM }]}>{p.label}</Text>
                    <View style={styles.planMetaRow}>
                      <Text style={styles.planMeta}>{p.months} {p.months === 1 ? "month" : "months"}</Text>
                      <View style={styles.metaDot} />
                      <Text style={styles.planMeta}>₹{perMonth(p)}/mo</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    {p.strikePrice ? <Text style={styles.strike}>₹{p.strikePrice}</Text> : null}
                    <Text style={[styles.price, sel && { color: GYM }]}>₹{p.price}</Text>
                    {save != null && (
                      <View style={styles.saveChip}>
                        <Ionicons name="trending-down" size={10} color="#059669" />
                        <Text style={styles.saveChipTxt}>{save}% off</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ── Location ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location</Text>
          <View style={styles.locCard}>
            <View style={styles.locIcon}><Ionicons name="location" size={20} color={GYM} /></View>
            <Text style={styles.locText} numberOfLines={2}>{gym.location || "—"}</Text>
            {gym.mapLink ? (
              <TouchableOpacity style={styles.mapBtn} onPress={openMaps} activeOpacity={0.85}>
                <Ionicons name="navigate" size={14} color="#fff" />
                <Text style={styles.mapBtnTxt}>Directions</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {/* ── Sticky bottom bar ── */}
      <View style={[styles.bottomBar, { paddingBottom: barBottomPad }]}>
        <View style={{ flex: 1 }}>
          {selectedPlan ? (
            <>
              <View style={styles.barTopRow}>
                <Text style={styles.bottomLabel} numberOfLines={1}>{selectedPlan.label} membership</Text>
                <View style={styles.barRating}>
                  <Ionicons name="star" size={11} color={GYM} />
                  <Text style={styles.barRatingTxt}>{ratingLabel}</Text>
                </View>
              </View>
              <Text style={styles.bottomPrice}>₹{selectedPlan.price}</Text>
            </>
          ) : (
            <View style={styles.barTopRow}>
              <Text style={styles.bottomLabel}>Select a plan to continue</Text>
              <View style={styles.barRating}>
                <Ionicons name="star" size={11} color={GYM} />
                <Text style={styles.barRatingTxt}>{ratingLabel}</Text>
              </View>
            </View>
          )}
        </View>
     <TouchableOpacity
  style={styles.ctaBtn}
  onPress={contactGym}
  activeOpacity={0.9}
>
  <Ionicons name="call" size={16} color="#fff" />
  <Text style={styles.ctaTxt}>Get membership</Text>
</TouchableOpacity>
      </View>

      {/* ── Booking summary bottom sheet ── */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={closeSheet}>
        {/* backdrop is padded by the live keyboard height, lifting the sheet above the keyboard */}
        <View style={[styles.sheetBackdrop, { paddingBottom: kbHeight }]}>
          <Pressable style={{ flex: 1 }} onPress={closeSheet} />

          <View style={[styles.sheet, { maxHeight: SCREEN_H - kbHeight - insets.top - 24 }]}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Confirm membership</Text>
              <TouchableOpacity onPress={closeSheet} hitSlop={10}>
                <Ionicons name="close" size={22} color={MUTED} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: barBottomPad + 8 }}
            >
              {/* plan summary */}
              {selectedPlan && (
                <View style={styles.summaryCard}>
                  <View style={styles.summaryIcon}><Ionicons name="barbell" size={18} color={GYM} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.summaryGym} numberOfLines={1}>{gym.name}</Text>
                    <Text style={styles.summaryPlan}>
                      {selectedPlan.label} · {selectedPlan.months} {selectedPlan.months === 1 ? "month" : "months"}
                    </Text>
                  </View>
                  <Text style={styles.summaryPrice}>₹{selectedPlan.price}</Text>
                </View>
              )}

              {/* member name */}
              <Text style={styles.fieldLabel}>Member name <Text style={styles.req}>*</Text></Text>
              <View style={styles.inputWrap}>
                <Ionicons name="person-outline" size={16} color={MUTED} />
                <TextInput
                  style={styles.input}
                  value={custName}
                  onChangeText={setCustName}
                  placeholder="Who is this membership for?"
                  placeholderTextColor="#B9BEC7"
                  returnKeyType="next"
                />
              </View>

              {/* phone (optional) */}
              <Text style={styles.fieldLabel}>Phone <Text style={styles.opt}>(optional)</Text></Text>
              <View style={styles.inputWrap}>
                <Ionicons name="call-outline" size={16} color={MUTED} />
                <TextInput
                  style={styles.input}
                  value={custPhone}
                  onChangeText={setCustPhone}
                  placeholder="10-digit mobile number"
                  placeholderTextColor="#B9BEC7"
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>

              {/* batch / timing */}
              {batches.length > 0 && (
                <>
                  <Text style={styles.fieldLabel}>Choose your batch <Text style={styles.req}>*</Text></Text>
                  <View style={styles.batchRow}>
                    {batches.map((b) => {
                      const sel = selectedBatch === b.label;
                      return (
                        <TouchableOpacity
                          key={b.label}
                          style={[styles.batchChip, sel && styles.batchChipSel]}
                          onPress={() => setSelectedBatch(b.label)}
                          activeOpacity={0.85}
                        >
                          <Ionicons name={batchIcon(b.label)} size={16} color={sel ? "#fff" : GYM} />
                          <View>
                            <Text style={[styles.batchLabel, sel && { color: "#fff" }]}>{b.label}</Text>
                            {!!b.time && (
                              <Text style={[styles.batchTime, sel && { color: "rgba(255,255,255,0.85)" }]}>{b.time}</Text>
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* promo code */}
              <Text style={styles.fieldLabel}>Promo code</Text>
              {appliedPromo ? (
                <View style={styles.promoApplied}>
                  <View style={styles.promoAppliedLeft}>
                    <Ionicons name="pricetag" size={15} color="#059669" />
                    <View>
                      <Text style={styles.promoAppliedCode}>{appliedPromo.code}</Text>
                      <Text style={styles.promoAppliedDesc}>{appliedPromo.description}</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={removePromo} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={MUTED} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.promoRow}>
                  <View style={[styles.inputWrap, { flex: 1, marginBottom: 0 }]}>
                    <Ionicons name="pricetag-outline" size={16} color={MUTED} />
                    <TextInput
                      style={styles.input}
                      value={promoInput}
                      onChangeText={(t) => { setPromoInput(t.toUpperCase()); setPromoError(null); }}
                      placeholder="Enter code"
                      placeholderTextColor="#B9BEC7"
                      autoCapitalize="characters"
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.promoBtn, (!promoInput.trim() || promoLoading) && { opacity: 0.5 }]}
                    onPress={applyPromo}
                    disabled={!promoInput.trim() || promoLoading}
                    activeOpacity={0.85}
                  >
                    {promoLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.promoBtnTxt}>Apply</Text>}
                  </TouchableOpacity>
                </View>
              )}
              {promoError && <Text style={styles.promoError}>{promoError}</Text>}

              {/* price breakdown */}
              <View style={styles.breakdown}>
                <View style={styles.breakRow}>
                  <Text style={styles.breakLabel}>Plan price</Text>
                  <Text style={styles.breakVal}>₹{baseAmount}</Text>
                </View>
                {discount > 0 && (
                  <View style={styles.breakRow}>
                    <Text style={[styles.breakLabel, { color: "#059669" }]}>Promo discount</Text>
                    <Text style={[styles.breakVal, { color: "#059669" }]}>− ₹{discount}</Text>
                  </View>
                )}
                <View style={styles.breakDivider} />
                <View style={styles.breakRow}>
                  <Text style={styles.totalLabel}>Total payable</Text>
                  <Text style={styles.totalVal}>₹{finalAmount}</Text>
                </View>
              </View>

              {/* confirm & pay — inside the scrollview so the keyboard never hides it */}
              <TouchableOpacity
                style={[styles.confirmBtn, paying && { opacity: 0.6 }]}
                onPress={confirmAndPay}
                disabled={paying}
                activeOpacity={0.9}
              >
                {paying ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="lock-closed" size={15} color="#fff" />
                    <Text style={styles.confirmTxt}>Confirm & Pay ₹{finalAmount}</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Full-screen image viewer ── */}
      <Modal visible={viewerOpen} animationType="fade" onRequestClose={() => setViewerOpen(false)} statusBarTranslucent>
        <View style={styles.viewerWrap}>
          <StatusBar barStyle="light-content" backgroundColor="#000" />
          <FlatList
            data={images}
            keyExtractor={(uri, i) => `${uri}-${i}`}
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            initialScrollIndex={viewerIndex}
            getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
            onMomentumScrollEnd={onViewerScroll}
            renderItem={({ item }) => (
              <View style={styles.viewerSlide}>
                <Image source={{ uri: item }} style={styles.viewerImg} resizeMode="contain" />
              </View>
            )}
          />
          <TouchableOpacity style={[styles.viewerClose, { top: insets.top + 8 }]} onPress={() => setViewerOpen(false)} activeOpacity={0.85}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          {hasMultiple && (
            <View style={[styles.viewerCounter, { top: insets.top + 14 }]}>
              <Text style={styles.viewerCounterTxt}>{viewerIndex + 1} / {images.length}</Text>
            </View>
          )}
          {hasMultiple && (
            <View style={[styles.viewerDots, { bottom: insets.bottom + 28 }]}>
              {images.map((_, i) => (
                <View key={i} style={[styles.viewerDot, i === viewerIndex && styles.viewerDotActive]} />
              ))}
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#F5F5F7" },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F5F5F7", gap: 12 },
  notFoundText:{ fontSize: 15, color: MUTED, fontWeight: "600" },

  // hero
  hero:        { height: HERO_H, position: "relative", backgroundColor: DARK },
  heroImg:     { width: SCREEN_W, height: HERO_H },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(11,18,32,0.32)" },
  backBtn: {
    position: "absolute", top: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 12 : 50,
    left: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center",
  },
  gymBadge: {
    position: "absolute", top: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 12 : 50,
    right: 16, flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: GYM, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99,
  },
  gymBadgeTxt: { color: "#fff", fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
  countPill: {
    position: "absolute", right: 16, top: HERO_H - 132, flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99,
  },
  countPillTxt: { color: "#fff", fontSize: 12, fontWeight: "700" },
  heroDots: { position: "absolute", bottom: 30, alignSelf: "center", flexDirection: "row", gap: 6 },
  heroDot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "rgba(255,255,255,0.45)" },
  heroDotActive: { backgroundColor: "#fff", width: 18 },
  heroBottom:  { position: "absolute", left: 18, right: 18, bottom: 33 },
  heroName:    { color: "#fff", fontSize: 26, fontWeight: "900", letterSpacing: -0.4 },
  heroLocRow:  { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  heroLocTxt:  { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600", flex: 1 },

  // stats
  statsCard: {
    flexDirection: "row", backgroundColor: "#fff", marginHorizontal: 16, marginTop: -22,
    borderRadius: 18, paddingVertical: 16, alignItems: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  statItem:     { flex: 1, alignItems: "center", gap: 4 },
  statIconWell: { width: 34, height: 34, borderRadius: 17, backgroundColor: TINT, justifyContent: "center", alignItems: "center", marginBottom: 2 },
  statValue:    { fontSize: 15, fontWeight: "900", color: INK },
  statLabel:    { fontSize: 11, color: MUTED, fontWeight: "600" },
  statDivider:  { width: 1, height: 44, backgroundColor: "#EEF0F3" },

  // sections
  section:     { marginTop: 24, paddingHorizontal: 16 },
  sectionTitle:{ fontSize: 18, fontWeight: "900", color: INK, letterSpacing: -0.3 },
  sectionSub:  { fontSize: 13, color: MUTED, marginTop: 2, marginBottom: 14, fontWeight: "500" },

  // plan cards
  planCard: {
    flexDirection: "row", alignItems: "center", gap: 13,
    backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1.5, borderColor: BORDER, position: "relative",
  },
  planCardSel: {
    borderColor: GYM, backgroundColor: TINT,
    shadowColor: GYM, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 3,
  },
  bestRibbon: {
    position: "absolute", top: -10, right: 16, flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: GYM, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99,
  },
  bestRibbonTxt: { color: "#fff", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  radio:    { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "#D1D5DB", justifyContent: "center", alignItems: "center" },
  radioSel: { borderColor: GYM, backgroundColor: GYM },
  planLabel:   { fontSize: 15, fontWeight: "800", color: INK },
  planMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  planMeta:    { fontSize: 12, color: MUTED, fontWeight: "600" },
  metaDot:     { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#D1D5DB" },
  strike:      { fontSize: 12, color: MUTED, textDecorationLine: "line-through", fontWeight: "600" },
  price:       { fontSize: 16, fontWeight: "900", color: INK },
  saveChip:    { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#ECFDF5", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, marginTop: 4 },
  saveChipTxt: { fontSize: 10, fontWeight: "800", color: "#059669" },
  emptyPlans:  { alignItems: "center", paddingVertical: 28, gap: 8 },
  emptyPlansTxt:{ fontSize: 13, color: MUTED, fontWeight: "500" },

  // amenities
  amenityGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  amenityCard: {
    flexDirection: "row", alignItems: "center", gap: 11, width: "47.5%",
    backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 12, borderRadius: 14,
  },
  amenityIconWell:{ width: 36, height: 36, borderRadius: 11, backgroundColor: TINT, justifyContent: "center", alignItems: "center" },
  amenityTxt:     { flex: 1, fontSize: 13, color: "#374151", fontWeight: "700" },

  // location
  locCard:  { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER },
  locIcon:  { width: 40, height: 40, borderRadius: 12, backgroundColor: TINT, justifyContent: "center", alignItems: "center" },
  locText:  { flex: 1, fontSize: 13, color: "#374151", fontWeight: "600", lineHeight: 19 },
  mapBtn:   { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: GYM, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  mapBtnTxt:{ color: "#fff", fontSize: 12, fontWeight: "800" },

  // bottom bar
  bottomBar: {
    position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", paddingHorizontal: 18, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: "#EEF0F3",
    shadowColor: "#000", shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 12,
  },
  barTopRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  barRating:   { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: TINT, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  barRatingTxt:{ fontSize: 11, fontWeight: "800", color: GYM },
  bottomLabel: { fontSize: 12, color: MUTED, fontWeight: "600", flexShrink: 1 },
  bottomPrice: { fontSize: 20, fontWeight: "900", color: INK, marginTop: 2 },
  ctaBtn: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: GYM, paddingHorizontal: 22, paddingVertical: 15, borderRadius: 14,
  },
  ctaTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },

  // ── booking sheet ──
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 18, paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E2E5EA", alignSelf: "center", marginBottom: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  sheetTitle:  { fontSize: 19, fontWeight: "900", color: INK, letterSpacing: -0.3 },

  summaryCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: TINT, borderRadius: 14, padding: 14, marginBottom: 18,
  },
  summaryIcon:  { width: 40, height: 40, borderRadius: 12, backgroundColor: "#fff", justifyContent: "center", alignItems: "center" },
  summaryGym:   { fontSize: 15, fontWeight: "800", color: INK },
  summaryPlan:  { fontSize: 12, fontWeight: "600", color: GYM, marginTop: 2 },
  summaryPrice: { fontSize: 18, fontWeight: "900", color: INK },

  fieldLabel: { fontSize: 13, fontWeight: "800", color: INK, marginBottom: 7 },
  req: { color: "#DC2626" },
  opt: { color: MUTED, fontWeight: "600" },
  inputWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F7F7F9", borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 12, height: 48, marginBottom: 16,
  },
  input: { flex: 1, fontSize: 14, fontWeight: "600", color: INK, padding: 0 },

  // batch chips
  batchRow:  { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  batchChip: {
    flexDirection: "row", alignItems: "center", gap: 8, minWidth: "47%",
    backgroundColor: "#fff", borderWidth: 1.5, borderColor: BORDER, borderRadius: 14,
    paddingHorizontal: 13, paddingVertical: 12,
  },
  batchChipSel: { backgroundColor: GYM, borderColor: GYM },
  batchLabel:   { fontSize: 14, fontWeight: "800", color: INK },
  batchTime:    { fontSize: 11, fontWeight: "600", color: MUTED, marginTop: 1 },

  // promo
  promoRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  promoBtn:   { backgroundColor: GYM, paddingHorizontal: 18, height: 48, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  promoBtnTxt:{ color: "#fff", fontSize: 14, fontWeight: "800" },
  promoError: { fontSize: 12, color: "#DC2626", fontWeight: "600", marginBottom: 8 },
  promoApplied: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#A7F3D0", borderRadius: 12,
    paddingHorizontal: 13, paddingVertical: 11, marginBottom: 6,
  },
  promoAppliedLeft: { flexDirection: "row", alignItems: "center", gap: 9 },
  promoAppliedCode: { fontSize: 14, fontWeight: "900", color: "#047857" },
  promoAppliedDesc: { fontSize: 11, fontWeight: "600", color: "#059669", marginTop: 1 },

  // breakdown
  breakdown:   { backgroundColor: "#F7F7F9", borderRadius: 14, padding: 14, marginTop: 12, marginBottom: 14 },
  breakRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 3 },
  breakLabel:  { fontSize: 13, fontWeight: "600", color: "#4B5563" },
  breakVal:    { fontSize: 13, fontWeight: "700", color: INK },
  breakDivider:{ height: 1, backgroundColor: "#E5E7EB", marginVertical: 8 },
  totalLabel:  { fontSize: 15, fontWeight: "900", color: INK },
  totalVal:    { fontSize: 18, fontWeight: "900", color: GYM },

  confirmBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GYM, borderRadius: 15, paddingVertical: 16, marginTop: 4,
  },
  confirmTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },

  // ── full-screen viewer ──
  viewerWrap:  { flex: 1, backgroundColor: "#000", justifyContent: "center" },
  viewerSlide: { width: SCREEN_W, height: SCREEN_H, justifyContent: "center", alignItems: "center" },
  viewerImg:   { width: SCREEN_W, height: SCREEN_H * 0.8 },
  viewerClose: {
    position: "absolute", right: 16, width: 42, height: 42, borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.18)", justifyContent: "center", alignItems: "center",
  },
  viewerCounter: { position: "absolute", alignSelf: "center", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 99 },
  viewerCounterTxt: { color: "#fff", fontSize: 13, fontWeight: "700" },
  viewerDots: { position: "absolute", alignSelf: "center", flexDirection: "row", gap: 7 },
  viewerDot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "rgba(255,255,255,0.4)" },
  viewerDotActive: { backgroundColor: "#fff", width: 18 },
});
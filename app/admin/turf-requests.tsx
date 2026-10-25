/**
 * app/admin/turf-requests.tsx — Admin: Turf Listing Requests
 *
 * Shows every request from app/list-turf.tsx (Firestore: turfRequests).
 *  - Tabs: Pending / Approved / Rejected, plus a city filter
 *  - Tap a request to open it: Call / WhatsApp the owner, Edit details,
 *    add the photos the owner sent on WhatsApp (image URLs, same as Add Turf)
 *  - Approve & go live → creates the turf in "turfs" as Call to Book
 *    (bookingMode "phone", bookingPhone = owner's phone, no owner account)
 *  - Reject → saves a reason
 * After approve/reject you can send the owner a WhatsApp message in one tap.
 * To switch an approved turf to online booking later, use the normal turf edit screens.
 *
 * Player-added turfs (submittedAs "player", from the "Add a Turf" chooser):
 *  - Marked with a blue PLAYER badge; a "From: All / Owners / Players" filter
 *  - "Added by" shows the player's name; PHONE is the turf's number
 *  - Price may be missing (0) — Approve asks you to Edit and add it first
 *  - NO WhatsApp: approve / reject sends the player an in-app push
 *    (server POST /turf-request/notify-result). No phone numbers shared.
 *  - The live turf keeps addedBy "player" + the player's uid for later
 *
 * Photos: players/owners upload them in the app (Cloudinary) — they show here
 * automatically. You can still remove one, or paste extra links.
 */
import { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, StatusBar,
  ActivityIndicator, Alert, Linking, RefreshControl, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  collection, getDocs, query, orderBy, doc, updateDoc, addDoc, serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { openWhatsApp } from "../../utils/whatsapp";
import { cldThumb } from "../../utils/cloudinary";
import { City, fetchCities, guessCity } from "../../utils/cities";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

const DARK = "#081120";
const GREEN = "#0E6B37";
const WA_GREEN = "#1FA855";
const RED = "#B42318";
const INK = "#111827";
const MUTED = "#6B7280";

type Status = "pending" | "approved" | "rejected";
type TurfRequest = {
  id: string;
  requestCode: string;
  status: Status;
  ownerName: string;
  phone: string;
  whatsappPhone?: string;
  email: string;
  turfName: string;
  state: string;
  city: string;
  area: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  pinAddress?: string;
  sports: string[];
  dayPrice: number;
  nightPrice: number;
  openingTime: number;
  closingTime: number;
  facilities: string[];
  wants: "listing" | "online" | "unsure";
  submittedAs?: "owner" | "player";   // missing = owner (older requests)
  reporterName?: string;
  reporterPhone?: string;
  submittedBy?: string | null;
  images?: string[];
  rejectReason?: string;
  turfId?: string;
  createdAt?: any;
};

const WANTS_LABEL: Record<string, string> = {
  listing: "Turf Listing (Free)",
  online: "Turf Booking (Online)",
  unsure: "Not sure yet",
};

const isPlayerReq = (r: TurfRequest) => r.submittedAs === "player";

const hourLabel = (h: number) => {
  const hh = Number(h) % 24;
  const t = hh % 12 === 0 ? 12 : hh % 12;
  return `${t} ${hh < 12 ? "AM" : "PM"}${Number(h) >= 24 ? " (next day)" : ""}`;
};
const timeAgo = (ts: any) => {
  const ms = ts?.toMillis ? ts.toMillis() : 0;
  if (!ms) return "";
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Yesterday" : `${d} days ago`;
};

function Detail({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <View style={[s.detail, full && { width: "100%" }]}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value || "—"}</Text>
    </View>
  );
}

function EditField({ label, value, onChange, numeric }: {
  label: string; value: string; onChange: (v: string) => void; numeric?: boolean;
}) {
  return (
    <View style={{ flex: 1, minWidth: 140 }}>
      <Text style={s.detailLabel}>{label}</Text>
      <TextInput style={s.input} value={value} onChangeText={onChange}
        keyboardType={numeric ? "numeric" : "default"} placeholderTextColor="#9CA3AF" />
    </View>
  );
}

export default function TurfRequests() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [requests, setRequests] = useState<TurfRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Status>("pending");
  const [city, setCity] = useState<string>("All");
  const [from, setFrom] = useState<"all" | "owner" | "player">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playonCities, setPlayonCities] = useState<City[]>([]);
  useEffect(() => { fetchCities(true).then(setPlayonCities).catch(() => {}); }, []);
  // Which PlayOn city a request belongs to: map pin first, then the typed city
  const cityFor = (r: TurfRequest) =>
    guessCity({ lat: r.latitude ?? null, lng: r.longitude ?? null, text: r.city || "" }, playonCities);

  // Edit state for the open request
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [photoInput, setPhotoInput] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = async () => {
    try {
      const snap = await getDocs(query(collection(db, "turfRequests"), orderBy("createdAt", "desc")));
      setRequests(snap.docs.map((d) => ({ id: d.id, images: [], ...(d.data() as any) })));
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not load requests.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  }), [requests]);

  const cities = useMemo(() => {
    const set = new Set(requests.map((r) => (r.city || "").trim()).filter(Boolean));
    return ["All", ...Array.from(set).sort()];
  }, [requests]);

  const list = useMemo(() => requests.filter((r) =>
    r.status === tab &&
    (city === "All" || (r.city || "").trim() === city) &&
    (from === "all" || (from === "player" ? isPlayerReq(r) : !isPlayerReq(r)))
  ), [requests, tab, city, from]);

  const patchLocal = (id: string, data: Partial<TurfRequest>) =>
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...data } : r)));

  const openRequest = (r: TurfRequest) => {
    if (openId === r.id) { setOpenId(null); return; }
    setOpenId(r.id);
    setEditing(false);
    setRejecting(false);
    setRejectReason("");
    setPhotoInput("");
  };

  const startEdit = (r: TurfRequest) => {
    setDraft({
      turfName: r.turfName, ownerName: r.ownerName || "", phone: r.phone, email: r.email || "",
      state: r.state, city: r.city, area: r.area, address: r.address || "",
      dayPrice: String(r.dayPrice ?? ""), nightPrice: String(r.nightPrice ?? ""),
      openingTime: String(r.openingTime ?? ""), closingTime: String(r.closingTime ?? ""),
      sports: (r.sports || []).join(", "), facilities: (r.facilities || []).join(", "),
    });
    setEditing(true);
  };

  const saveEdit = async (r: TurfRequest) => {
    const open = Number(draft.openingTime), close = Number(draft.closingTime);
    if (!draft.turfName.trim()) return Alert.alert("Check", "Turf name is required.");
    if (!/^[6-9]\d{9}$/.test(draft.phone.replace(/\D/g, "").slice(-10))) return Alert.alert("Check", "Phone must be 10 digits.");
    if (!(Number(draft.dayPrice) > 0)) return Alert.alert("Check", "Day price must be more than 0.");
    if (!(open >= 0 && open <= 23 && close > open && close <= 28)) return Alert.alert("Check", "Opening 0–23, closing after opening (max 28 = 4 AM).");
    const data: Partial<TurfRequest> = {
      turfName: draft.turfName.trim(), ownerName: draft.ownerName.trim(),
      phone: draft.phone.replace(/\D/g, "").slice(-10), email: draft.email.trim().toLowerCase(),
      state: draft.state.trim(), city: draft.city.trim(), area: draft.area.trim(), address: draft.address.trim(),
      dayPrice: Number(draft.dayPrice), nightPrice: Number(draft.nightPrice) || Number(draft.dayPrice),
      openingTime: open, closingTime: close,
      sports: draft.sports.split(",").map((x) => x.trim()).filter(Boolean),
      facilities: draft.facilities.split(",").map((x) => x.trim()).filter(Boolean),
    };
    try {
      setBusy(true);
      await updateDoc(doc(db, "turfRequests", r.id), { ...data, updatedAt: serverTimestamp() });
      patchLocal(r.id, data);
      setEditing(false);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const savePhotos = async (r: TurfRequest, images: string[]) => {
    try {
      await updateDoc(doc(db, "turfRequests", r.id), { images });
      patchLocal(r.id, { images });
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save photo.");
    }
  };
  const addPhoto = (r: TurfRequest) => {
    const url = photoInput.trim();
    if (!/^https?:\/\//i.test(url)) return Alert.alert("Photo", "Paste a full image link (https://…).");
    setPhotoInput("");
    savePhotos(r, [...(r.images || []), url]);
  };
  const removePhoto = (r: TurfRequest, i: number) =>
    savePhotos(r, (r.images || []).filter((_, idx) => idx !== i));

  // Player requests → in-app push notification (server reads the status /
  // reason from Firestore and notifies the player). Never blocks the admin.
  const notifyPlayer = async (r: TurfRequest) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      fetch(`${SERVER_URL}/turf-request/notify-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId: r.id }),
      }).catch(() => {});
    } catch { /* silent */ }
  };

  // Owner requests → offer a WhatsApp message to the owner (as before).
  // Player requests → automatic in-app notification, no WhatsApp.
  const tellOwner = (r: TurfRequest, text: string) => {
    if (isPlayerReq(r)) {
      notifyPlayer(r);
      return;
    }
    const to = r.whatsappPhone || r.phone;
    if (!to) return;
    Alert.alert("Tell the owner?", "Send this update to the owner on WhatsApp.", [
      { text: "Not now", style: "cancel" },
      { text: "Open WhatsApp", onPress: () => openWhatsApp(to, text) },
    ]);
  };

  const doApprove = async (r: TurfRequest) => {
    try {
      setBusy(true);
      const images = r.images || [];
      const hasPin = r.latitude != null && r.longitude != null;
      const turfRef = await addDoc(collection(db, "turfs"), {
        name: r.turfName,
        location: [r.area, r.city].filter(Boolean).join(", "),
        area: r.area,
        city: r.city,
        // ✅ All-India: PlayOn city (empty when the typed city isn't set up yet)
        cityId: cityFor(r)?.id || "",
        cityName: cityFor(r)?.name || "",
        locality: r.area || "",
        state: r.state,
        address: r.address || "",
        sport: r.sports || [],
        mapLink: hasPin ? `https://maps.google.com/?q=${r.latitude},${r.longitude}` : "",
        ...(hasPin ? { latitude: r.latitude, longitude: r.longitude } : {}),
        dayPrice: Number(r.dayPrice) || 0,
        nightPrice: Number(r.nightPrice) || Number(r.dayPrice) || 0,
        price: Number(r.dayPrice) || 0,
        openingTime: Number(r.openingTime),
        closingTime: Number(r.closingTime),
        slotDuration: 60,
        slotBookingEnabled: true,
        image: images[0] || "",
        images,
        facilities: r.facilities || [],
        // Listing turfs have no owner login — owner details kept for contact
        ownerId: "",
        ownerName: r.ownerName || "",
        ownerEmail: r.email || "",
        ownerPhone: r.phone,
        addedBy: isPlayerReq(r) ? "player" : "owner",
        addedByUid: r.submittedBy ?? null,
        operatorId: "",
        operatorName: "",
        operatorEmail: "",
        active: true,
        createdAt: serverTimestamp(),
        bookingPrice: 0,
        bookingMode: "phone",
        bookingPhone: r.phone,
        venueType: "turf",
        ballMachineEnabled: false,
        listingType: "listing",
        listingRequestId: r.id,
      });
      await updateDoc(doc(db, "turfRequests", r.id), {
        status: "approved",
        turfId: turfRef.id,
        approvedAt: serverTimestamp(),
        approvedBy: auth.currentUser?.uid ?? null,
      });
      patchLocal(r.id, { status: "approved", turfId: turfRef.id });
      setOpenId(null);
      tellOwner(r, isPlayerReq(r)
        ? [
            `Hi ${r.reporterName || ""},`.replace(" ,", ","),
            `Thanks for adding *${r.turfName}* — it's now live on PlayOn!`,
            `Players near you can find it and call to book.`,
            `Know another turf? Add it from the app: Home → Add a Turf.`,
            `– Team PlayOn`,
          ].join("\n")
        : [
            `Hi ${r.ownerName},`,
            `Your turf *${r.turfName}* is now live on PlayOn.`,
            `Players near you can see your price, timings and facilities, and call you to book.`,
            `To change timings or price, just WhatsApp us here.`,
            `– Team PlayOn`,
          ].join("\n"));
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not approve.");
    } finally {
      setBusy(false);
    }
  };

  const approve = (r: TurfRequest) => {
    // Players can leave price empty — don't publish a "₹0/hr" turf
    if (!(Number(r.dayPrice) > 0)) {
      return Alert.alert(
        "Add the price first",
        "This turf has no price yet. Call the turf, then tap Edit and add the day price before approving.",
      );
    }
    const noPhotos = !(r.images || []).length;
    const noPin = r.latitude == null || r.longitude == null;
    const city = cityFor(r);
    const warns = [
      !city ? `• "${r.city || "No city"}" isn't one of your cities yet — the turf will be saved without a city and players won't see it. Add the city in Admin → Cities, then tag the turf there.` : null,
      noPhotos ? "• No photos added yet (a default image will show)" : null,
      noPin ? "• No map pin (turf won't sort by distance)" : null,
    ].filter(Boolean).join("\n");
    Alert.alert(
      "Approve & go live?",
      `"${r.turfName}" will go live${city ? ` in ${city.name}` : ""} as Call to Book with ${r.phone}.${warns ? "\n\n" + warns : ""}`,
      [{ text: "Cancel", style: "cancel" }, { text: "Approve", onPress: () => doApprove(r) }],
    );
  };

  const reject = async (r: TurfRequest) => {
    const reason = rejectReason.trim();
    if (!reason) return Alert.alert("Reason needed", "Write a short reason for the owner.");
    try {
      setBusy(true);
      await updateDoc(doc(db, "turfRequests", r.id), {
        status: "rejected", rejectReason: reason, rejectedAt: serverTimestamp(),
      });
      patchLocal(r.id, { status: "rejected", rejectReason: reason });
      setOpenId(null);
      setRejecting(false);
      tellOwner(r, isPlayerReq(r)
        ? [
            `Hi ${r.reporterName || ""},`.replace(" ,", ","),
            `Thanks for adding *${r.turfName}* on PlayOn. We couldn't add it right now.`,
            `Reason: ${reason}`,
            `Reply here if you have more details.`,
            `– Team PlayOn`,
          ].join("\n")
        : [
            `Hi ${r.ownerName},`,
            `Thanks for listing *${r.turfName}* on PlayOn. We couldn't approve it right now.`,
            `Reason: ${reason}`,
            `Reply here if you'd like to update the details.`,
            `– Team PlayOn`,
          ].join("\n"));
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not reject.");
    } finally {
      setBusy(false);
    }
  };

  const statusPill = (st: Status) => (
    <View style={[s.pill, st === "pending" ? s.pillPending : st === "approved" ? s.pillApproved : s.pillRejected]}>
      <Text style={[s.pillTxt, st === "pending" ? { color: "#7A5300" } : st === "approved" ? { color: GREEN } : { color: RED }]}>
        {st.toUpperCase()}
      </Text>
    </View>
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <View style={s.headerRow}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Turf Requests</Text>
        </View>
        <View style={s.tabs}>
          {(["pending", "approved", "rejected"] as Status[]).map((t) => (
            <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabOn]} onPress={() => { setTab(t); setOpenId(null); }}>
              <Text style={[s.tabTxt, tab === t && s.tabTxtOn]}>
                {t[0].toUpperCase() + t.slice(1)} ({counts[t]})
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── From filter: owners vs players ── */}
      <View style={s.fromRow}>
        {([["all", "All"], ["owner", "Owners"], ["player", "Players"]] as const).map(([k, label]) => (
          <TouchableOpacity key={k} style={[s.cityChip, from === k && s.cityChipOn]} onPress={() => { setFrom(k); setOpenId(null); }}>
            <Text style={[s.cityTxt, from === k && { color: "#fff" }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── City filter ── */}
      {cities.length > 2 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
          {cities.map((c) => (
            <TouchableOpacity key={c} style={[s.cityChip, city === c && s.cityChipOn]} onPress={() => setCity(c)}>
              <Text style={[s.cityTxt, city === c && { color: "#fff" }]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={GREEN} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          keyboardShouldPersistTaps="handled"
        >
          {list.length === 0 && (
            <View style={s.empty}>
              <Ionicons name="file-tray-outline" size={32} color="#D1D5DB" />
              <Text style={s.emptyTxt}>
                No {tab} {from === "player" ? "player " : from === "owner" ? "owner " : ""}requests{city !== "All" ? ` in ${city}` : ""}.
              </Text>
            </View>
          )}

          {list.map((r) => {
            const open = openId === r.id;
            return (
              <View key={r.id} style={[s.card, open && s.cardOpen]}>
                <TouchableOpacity style={s.cardHead} onPress={() => openRequest(r)} activeOpacity={0.8}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.turfName} numberOfLines={1}>{r.turfName}</Text>
                    <Text style={s.meta} numberOfLines={1}>
                      {r.requestCode} · {[r.area, r.city].filter(Boolean).join(", ")} · {timeAgo(r.createdAt)}
                    </Text>
                  </View>
                  {isPlayerReq(r) && (
                    <View style={[s.pill, s.pillPlayer]}><Text style={[s.pillTxt, { color: "#1D4ED8" }]}>PLAYER</Text></View>
                  )}
                  {statusPill(r.status)}
                </TouchableOpacity>

                {open && !editing && (
                  <>
                    <View style={s.details}>
                      {isPlayerReq(r) ? (
                        <>
                          <Detail label="TURF PHONE" value={`+91 ${r.phone}`} />
                          <Detail label="ADDED BY (PLAYER)" value={`${r.reporterName || "—"} · gets an app notification`} />
                        </>
                      ) : (
                        <>
                          <Detail label="OWNER" value={r.ownerName} />
                          <Detail label="PHONE" value={`+91 ${r.phone}`} />
                          {r.whatsappPhone && r.whatsappPhone !== r.phone ? <Detail label="WHATSAPP" value={`+91 ${r.whatsappPhone}`} /> : null}
                          <Detail label="EMAIL" value={r.email} full />
                        </>
                      )}
                      <Detail label="CITY" value={`${r.city}, ${r.state}`} full />
                      {r.address ? <Detail label="ADDRESS" value={r.address} full /> : null}
                      <Detail
                        label="PRICE / HR"
                        value={Number(r.dayPrice) > 0 ? `Day ₹${r.dayPrice} · Night ₹${r.nightPrice}` : "Not known — add before approving"}
                      />
                      <Detail label="TIMINGS" value={`${hourLabel(r.openingTime)} – ${hourLabel(r.closingTime)}`} />
                      <Detail label="SPORTS" value={(r.sports || []).join(", ")} full />
                      <Detail label="FACILITIES" value={(r.facilities || []).join(", ")} full />
                      {!isPlayerReq(r) && <Detail label="WANTS" value={WANTS_LABEL[r.wants] || r.wants} full />}
                      <Detail label="MAP PIN" value={r.latitude != null ? `${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)}` : "Not added"} full />
                      {r.status === "rejected" && r.rejectReason ? <Detail label="REJECT REASON" value={r.rejectReason} full /> : null}
                    </View>

                    {/* Photos (from WhatsApp) */}
                    {r.status === "pending" && (
                      <View style={s.section}>
                        <Text style={s.detailLabel}>
                          PHOTOS ({(r.images || []).length}) — FIRST ONE IS THE COVER{(r.images || []).length ? " · TAP ✕ TO REMOVE A BAD ONE" : ""}
                        </Text>
                        {(r.images || []).length > 0 && (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                            {(r.images || []).map((url, i) => (
                              <View key={url + i}>
                                <Image source={{ uri: cldThumb(url, 300) }} style={s.thumb} />
                                <TouchableOpacity style={s.thumbX} onPress={() => removePhoto(r, i)} accessibilityLabel="Remove photo">
                                  <Ionicons name="close" size={14} color="#fff" />
                                </TouchableOpacity>
                              </View>
                            ))}
                          </ScrollView>
                        )}
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TextInput style={[s.input, { flex: 1 }]} placeholder="Paste image link" placeholderTextColor="#9CA3AF"
                            autoCapitalize="none" value={photoInput} onChangeText={setPhotoInput} />
                          <TouchableOpacity style={s.addPhotoBtn} onPress={() => addPhoto(r)} accessibilityLabel="Add photo">
                            <Ionicons name="add" size={22} color="#fff" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {/* Contact + edit */}
                    <View style={s.btnRow}>
                      <TouchableOpacity style={s.outlineBtn} onPress={() => Linking.openURL(`tel:${r.phone}`)}>
                        <Ionicons name="call-outline" size={16} color={INK} />
                        <Text style={s.outlineTxt}>{isPlayerReq(r) ? "Call turf" : "Call"}</Text>
                      </TouchableOpacity>
                      {isPlayerReq(r) ? null : (
                        <TouchableOpacity style={[s.outlineBtn, { borderColor: WA_GREEN }]}
                          onPress={() => openWhatsApp(r.whatsappPhone || r.phone, `Hi ${r.ownerName}, this is Team PlayOn about your turf listing (${r.requestCode}).`)}>
                          <Ionicons name="logo-whatsapp" size={16} color="#137A3C" />
                          <Text style={[s.outlineTxt, { color: "#137A3C" }]}>WhatsApp</Text>
                        </TouchableOpacity>
                      )}
                      {r.status === "pending" && (
                        <TouchableOpacity style={s.outlineBtn} onPress={() => startEdit(r)}>
                          <Ionicons name="create-outline" size={16} color={INK} />
                          <Text style={s.outlineTxt}>Edit</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Approve / reject */}
                    {r.status === "pending" && !rejecting && (
                      <View style={s.btnRow}>
                        <TouchableOpacity style={[s.rejectBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => setRejecting(true)}>
                          <Text style={s.rejectTxt}>Reject</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[s.approveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => approve(r)}>
                          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.approveTxt}>Approve & go live</Text>}
                        </TouchableOpacity>
                      </View>
                    )}
                    {r.status === "pending" && rejecting && (
                      <View style={s.section}>
                        <Text style={s.detailLabel}>REASON FOR OWNER</Text>
                        <TextInput style={[s.input, { height: 70, paddingTop: 10, textAlignVertical: "top" }]} multiline
                          placeholder="e.g. Could not verify the turf location" placeholderTextColor="#9CA3AF"
                          value={rejectReason} onChangeText={setRejectReason} />
                        <View style={s.btnRow}>
                          <TouchableOpacity style={s.outlineBtn} onPress={() => setRejecting(false)}>
                            <Text style={s.outlineTxt}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[s.approveBtn, { backgroundColor: RED }, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => reject(r)}>
                            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.approveTxt}>Confirm reject</Text>}
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                    {r.status === "approved" && r.turfId ? (
                      <Text style={s.note}>Live as Call to Book · Turf ID {r.turfId}</Text>
                    ) : null}
                  </>
                )}

                {/* Edit mode */}
                {open && editing && (
                  <View style={s.section}>
                    <View style={s.editGrid}>
                      <EditField label="TURF NAME" value={draft.turfName} onChange={(v) => setDraft({ ...draft, turfName: v })} />
                      {!isPlayerReq(r) && <EditField label="OWNER" value={draft.ownerName} onChange={(v) => setDraft({ ...draft, ownerName: v })} />}
                      <EditField label={isPlayerReq(r) ? "TURF PHONE" : "PHONE"} value={draft.phone} numeric onChange={(v) => setDraft({ ...draft, phone: v })} />
                      {!isPlayerReq(r) && <EditField label="EMAIL" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} />}
                      <EditField label="STATE" value={draft.state} onChange={(v) => setDraft({ ...draft, state: v })} />
                      <EditField label="CITY" value={draft.city} onChange={(v) => setDraft({ ...draft, city: v })} />
                      <EditField label="AREA" value={draft.area} onChange={(v) => setDraft({ ...draft, area: v })} />
                      <EditField label="ADDRESS" value={draft.address} onChange={(v) => setDraft({ ...draft, address: v })} />
                      <EditField label="DAY ₹/HR" value={draft.dayPrice} numeric onChange={(v) => setDraft({ ...draft, dayPrice: v })} />
                      <EditField label="NIGHT ₹/HR" value={draft.nightPrice} numeric onChange={(v) => setDraft({ ...draft, nightPrice: v })} />
                      <EditField label="OPENS (0–23)" value={draft.openingTime} numeric onChange={(v) => setDraft({ ...draft, openingTime: v })} />
                      <EditField label="CLOSES (1–28)" value={draft.closingTime} numeric onChange={(v) => setDraft({ ...draft, closingTime: v })} />
                    </View>
                    <EditField label="SPORTS (comma separated)" value={draft.sports} onChange={(v) => setDraft({ ...draft, sports: v })} />
                    <EditField label="FACILITIES (comma separated)" value={draft.facilities} onChange={(v) => setDraft({ ...draft, facilities: v })} />
                    <View style={s.btnRow}>
                      <TouchableOpacity style={s.outlineBtn} onPress={() => setEditing(false)}>
                        <Text style={s.outlineTxt}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.approveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => saveEdit(r)}>
                        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.approveTxt}>Save changes</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F0F4F8" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: { backgroundColor: DARK, paddingHorizontal: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 19, fontWeight: "900" },
  tabs: { flexDirection: "row", marginTop: 8 },
  tab: { flex: 1, height: 44, alignItems: "center", justifyContent: "center", borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: "#B9F24C" },
  tabTxt: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: "600" },
  tabTxtOn: { color: "#fff", fontWeight: "900" },

  cityChip: { height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", justifyContent: "center" },
  cityChipOn: { backgroundColor: DARK, borderColor: DARK },
  cityTxt: { fontSize: 13, fontWeight: "700", color: INK },

  empty: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTxt: { fontSize: 14, color: MUTED, fontWeight: "600" },

  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  cardOpen: { borderWidth: 2, borderColor: GREEN, paddingBottom: 14 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  turfName: { fontSize: 16, fontWeight: "900", color: INK },
  meta: { fontSize: 12, color: MUTED, marginTop: 3 },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  pillPending: { backgroundColor: "#FFF3D6" },
  pillApproved: { backgroundColor: "#E3F2E7" },
  pillRejected: { backgroundColor: "#FDE8E7" },
  pillPlayer: { backgroundColor: "#DBEAFE" },
  fromRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  pillTxt: { fontSize: 11, fontWeight: "900" },

  details: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#EEF1EF", rowGap: 12 },
  detail: { width: "50%", paddingRight: 8 },
  detailLabel: { fontSize: 11, fontWeight: "700", color: MUTED, marginBottom: 4, letterSpacing: 0.3 },
  detailValue: { fontSize: 13, color: INK },

  section: { paddingHorizontal: 14, paddingTop: 14, gap: 10 },
  input: { height: 44, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, paddingHorizontal: 12, fontSize: 14, color: INK, backgroundColor: "#F9FAFB" },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: "#E5E7EB" },
  thumbX: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  addPhotoBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: DARK, alignItems: "center", justifyContent: "center" },
  editGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },

  btnRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 2 },
  outlineBtn: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  outlineTxt: { fontSize: 13, fontWeight: "800", color: INK },
  rejectBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: RED, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  rejectTxt: { fontSize: 14, fontWeight: "800", color: RED },
  approveBtn: { flex: 2, height: 48, borderRadius: 12, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  approveTxt: { fontSize: 14, fontWeight: "900", color: "#fff" },
  note: { fontSize: 12, color: GREEN, fontWeight: "700", paddingHorizontal: 14, paddingTop: 12 },
});
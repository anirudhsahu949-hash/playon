/**
 * app/admin/apl-settings.tsx — set up a league without touching Firestore.
 *
 * Writes appConfig/{leagueId}. Everything the player screens, the form, the
 * payment and the refund read comes from here, so changing the fee or closing
 * registration is a tap — no app update, no console.
 *
 * Works for any league: change the League ID at the top and press Load.
 */
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Image,
  ActivityIndicator, StatusBar, Alert, Switch, Platform, KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import DateTimePicker from "../../components/WebSafeDatePicker";

import { auth, db } from "../../firebaseConfig";
import { pickPhotos, uploadPhoto, cldThumb } from "../../utils/cloudinary";

const CLOUD_NAME = "ptaivw9h";
const UPLOAD_PRESET = "playon_turf";

// The shared uploadPhoto() re-saves everything as JPEG, and JPEG cannot hold
// transparency — that is what turns a clear logo background into a white box.
// So the logo goes to Cloudinary exactly as it was picked.
async function uploadLogoKeepingTransparency(uri: string): Promise<string> {
  const form = new FormData();
  form.append("file", { uri, type: "image/png", name: `logo_${Date.now()}.png` } as any);
  form.append("upload_preset", UPLOAD_PRESET);
  form.append("tags", "league-logo");

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!res.ok || !data?.secure_url) throw new Error(data?.error?.message || "Upload failed");
  return data.secure_url as string;
}

const GREEN   = "#16A34A";
const GREEN_D = "#15803D";
const DARK    = "#0B1220";
const BG      = "#F3F4F6";
const BORDER  = "#E5E7EB";
const MUTED   = "#6B7280";

const DEFAULT_ID = "apl-2026";

// "2026-12-10" for the server, "10 Dec 2026" for people
const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromYmd = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
};
const pretty = (s: string) => {
  const d = fromYmd(s);
  return d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
};

export default function AplSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [leagueId, setLeagueId] = useState(DEFAULT_ID);
  const [exists, setExists]     = useState(false);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [picker, setPicker]     = useState<null | "last" | "auction">(null);

  // the form
  const [leagueName, setLeagueName]   = useState("Amravati Premier League");
  const [season, setSeason]           = useState("Season 1 · 2026");
  const [logoUrl, setLogoUrl]         = useState("");
  const [sponsorText, setSponsor]     = useState("Sponsored by PlayOn");
  const [passBgUrl, setPassBg]        = useState("");
  const [open, setOpen]               = useState(true);
  const [fee, setFee]                 = useState("500");
  const [charge, setCharge]           = useState("15");
  const [commission, setCommission]   = useState("0");
  const [teamFee, setTeamFee]         = useState("10500");
  const [lastDate, setLastDate]       = useState("");
  const [auctionDate, setAuctionDate] = useState("");
  const [leagueDates, setLeagueDates] = useState("18, 19 & 20 December");
  const [venue, setVenue]             = useState("LV Turf, Chitra");
  const [instagramUrl, setInstagram]  = useState("");
  const [whatsappLink, setWhatsapp]   = useState("");
  const [ownerWhatsapp, setOwnerWa]   = useState("");
  const [nextRegNo, setNextRegNo]     = useState(1);
  const [ownerId, setOwnerId]         = useState("");

  const load = async (id = leagueId) => {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, "appConfig", id.trim()));
      if (snap.exists()) {
        const c: any = snap.data();
        setExists(true);
        setLeagueName(c.leagueName || "");
        setSeason(c.season || "");
        setLogoUrl(c.logoUrl || "");
        setSponsor(c.sponsorText ?? "");
        setPassBg(c.passBgUrl || "");
        setOpen(c.registrationOpen !== false);
        setFee(String(c.fee ?? ""));
        setCharge(String(c.gatewayCharge ?? ""));
        setCommission(String(c.commission ?? 0));
        setTeamFee(String(c.teamFee ?? ""));
        setLastDate(c.lastDate || "");
        setAuctionDate(c.auctionDate || "");
        setLeagueDates(c.leagueDates || "");
        setVenue(c.venue || "");
        setInstagram(c.instagramUrl || "");
        setWhatsapp(c.whatsappLink || "");
        setOwnerWa(c.ownerWhatsapp || "");
        setNextRegNo(Number(c.nextRegNo || 1));
        setOwnerId(c.ownerId || "");
      } else {
        setExists(false);
        setNextRegNo(1);
        setOwnerId(auth.currentUser?.uid || "");
      }
    } catch (e: any) {
      Alert.alert("Could not load", e?.message || "Check your internet.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(DEFAULT_ID); }, []);

  const uploadLogo = async () => {
    try {
      const picked = await pickPhotos(1);
      if (!picked.length) return;
      setUploading(true);
      const url = await uploadLogoKeepingTransparency(picked[0]);
      setLogoUrl(url);
    } catch (e: any) {
      if (e?.message === "PERMISSION") Alert.alert("Permission needed", "Allow photo access to upload the logo.");
      else Alert.alert("Upload failed", "Please try again.");
    } finally { setUploading(false); }
  };

  // The pass background carries no transparency, so the normal uploader is fine.
  const uploadPassBg = async () => {
    try {
      const picked = await pickPhotos(1);
      if (!picked.length) return;
      setUploadingBg(true);
      const url = await uploadPhoto(picked[0], "league-pass-bg");
      setPassBg(url);
    } catch (e: any) {
      if (e?.message === "PERMISSION") Alert.alert("Permission needed", "Allow photo access to upload the background.");
      else Alert.alert("Upload failed", "Please try again.");
    } finally { setUploadingBg(false); }
  };

  const confirmSave = () => {
    const id = leagueId.trim();
    if (!/^[a-z0-9-]{3,40}$/.test(id)) return Alert.alert("League ID", "Use small letters, numbers and hyphens only (e.g. apl-2026).");
    if (!leagueName.trim())            return Alert.alert("League name", "Give the league a name.");
    const f = Number(fee);
    if (!f || f <= 0)                  return Alert.alert("Fee", "Registration fee must be more than 0.");
    if (Number(charge) < 0)            return Alert.alert("Gateway charge", "Cannot be less than 0.");
    if (lastDate && !fromYmd(lastDate))return Alert.alert("Last date", "Pick the date again.");

    const lines = [
      `League: ${leagueName.trim()} (${id})`,
      `Registration: ${open ? "OPEN" : "CLOSED"}`,
      `Player pays: ₹${f + Number(charge || 0)}  (fee ₹${f} + charge ₹${Number(charge || 0)})`,
      lastDate ? `Last date: ${pretty(lastDate)}` : "Last date: none",
      auctionDate ? `Auction: ${auctionDate}` : "Auction date: not set",
      sponsorText.trim() ? `Sponsor line: ${sponsorText.trim()}` : "Sponsor line: hidden",
      logoUrl ? "Logo: added" : "Logo: none",
      passBgUrl ? "Pass background: added" : "Pass background: none",
    ];
    if (f === 1) lines.push("⚠️ Fee is ₹1 — test mode");

    Alert.alert(exists ? "Save changes?" : "Create this league?", lines.map((l) => `• ${l}`).join("\n"), [
      { text: "Cancel", style: "cancel" },
      { text: exists ? "Save" : "Create", onPress: save },
    ]);
  };

  const save = async () => {
    const id = leagueId.trim();
    setSaving(true);
    try {
      await setDoc(doc(db, "appConfig", id), {
        leagueId:         id,
        leagueName:       leagueName.trim(),
        season:           season.trim(),
        logoUrl:          logoUrl.trim(),
        sponsorText:      sponsorText.trim(),
        passBgUrl:        passBgUrl.trim(),
        registrationOpen: open,
        fee:              Number(fee),
        gatewayCharge:    Number(charge || 0),
        commission:       Number(commission || 0),
        teamFee:          Number(teamFee || 0),
        lastDate:         lastDate,
        auctionDate:      auctionDate.trim(),
        leagueDates:      leagueDates.trim(),
        venue:            venue.trim(),
        instagramUrl:     instagramUrl.trim(),
        whatsappLink:     whatsappLink.trim(),
        ownerWhatsapp:    ownerWhatsapp.replace(/\D/g, ""),
        ownerId:          ownerId || auth.currentUser?.uid || "",
        ...(exists ? {} : { nextRegNo: 1, createdAt: serverTimestamp() }),
        updatedAt:        serverTimestamp(),
      }, { merge: true });

      setExists(true);
      Alert.alert("Saved", exists ? "The league is updated." : "League created. Open the APL screen in the app to see it.");
    } catch (e: any) {
      Alert.alert("Could not save", e?.message || "Try again.");
    } finally { setSaving(false); }
  };

  if (loading) {
    return <View style={[s.center, { backgroundColor: BG }]}><ActivityIndicator size="large" color={GREEN} /></View>;
  }

  const total = Number(fee || 0) + Number(charge || 0);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: BG }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={s.hBtn}>
          <Ionicons name="chevron-back" size={20} color="#E5E7EB" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>League Setup</Text>
          <Text style={s.hSub}>{exists ? "Editing an existing league" : "New league — not created yet"}</Text>
        </View>
        <View style={[s.livePill, { backgroundColor: open ? "#112B1C" : "#2A1212", borderColor: open ? "#1B5E35" : "#7F1D1D" }]}>
          <Text style={[s.livePillTxt, { color: open ? "#86EFAC" : "#FCA5A5" }]}>{open ? "OPEN" : "CLOSED"}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 90 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* league id */}
        <Text style={s.section}>LEAGUE ID</Text>
        <View style={s.card}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={leagueId}
              onChangeText={(v) => setLeagueId(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="apl-2026"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
            />
            <TouchableOpacity style={s.loadBtn} onPress={() => load()} activeOpacity={0.85}>
              <Text style={s.loadTxt}>Load</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.hint}>
            This is the league's name in the database. Keep <Text style={{ fontWeight: "700" }}>apl-2026</Text> for APL.
            For a new league next season, type a new id and press Load — then fill it in fresh.
          </Text>
        </View>

        {/* basics */}
        <Text style={s.section}>LEAGUE</Text>
        <View style={s.card}>
          <Field label="League name" value={leagueName} onChange={setLeagueName} placeholder="Amravati Premier League" />
          <Field label="Season" value={season} onChange={setSeason} placeholder="Season 1 · 2026" />
          <Field label="Match days (shown to players)" value={leagueDates} onChange={setLeagueDates} placeholder="18, 19 & 20 December" />
          <Field label="Venue" value={venue} onChange={setVenue} placeholder="LV Turf, Chitra" />
          <Field label="Sponsor line" value={sponsorText} onChange={setSponsor} placeholder="Sponsored by PlayOn" last />
          <Text style={s.hint}>
            The small badge at the top of the league screen. Put a sponsor's name here when you sell that spot;
            leave it empty and no badge is shown.
          </Text>

          <Text style={[s.label, { marginTop: 16 }]}>League logo</Text>
          <View style={s.uploadRow}>
            <View style={s.logoBox}>
              {logoUrl
                ? <Image source={{ uri: cldThumb(logoUrl, 200) }} style={{ width: 64, height: 64 }} resizeMode="contain" />
                : <Ionicons name="trophy-outline" size={26} color="#9CA3AF" />}
            </View>
            <TouchableOpacity style={[s.uploadBtn, uploading && { opacity: 0.6 }]} onPress={uploadLogo} disabled={uploading}>
              {uploading ? <ActivityIndicator color="#FFFFFF" size="small" />
                : <><Ionicons name="cloud-upload-outline" size={16} color="#FFFFFF" /><Text style={s.uploadTxt}>{logoUrl ? "Change" : "Upload"}</Text></>}
            </TouchableOpacity>
            {!!logoUrl && (
              <TouchableOpacity onPress={() => setLogoUrl("")} style={s.removeBtn}>
                <Text style={s.removeTxt}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={s.hint}>Shown on the league screen. Use a PNG — a JPEG logo arrives with a white box around it.</Text>

          <Text style={[s.label, { marginTop: 18 }]}>Player pass background</Text>
          <View style={s.uploadRow}>
            <View style={[s.logoBox, { backgroundColor: DARK }]}>
              {passBgUrl
                ? <Image source={{ uri: cldThumb(passBgUrl, 240) }} style={{ width: 72, height: 72 }} resizeMode="cover" />
                : <Ionicons name="card-outline" size={24} color="#6B7280" />}
            </View>
            <TouchableOpacity style={[s.uploadBtn, uploadingBg && { opacity: 0.6 }]} onPress={uploadPassBg} disabled={uploadingBg}>
              {uploadingBg ? <ActivityIndicator color="#FFFFFF" size="small" />
                : <><Ionicons name="cloud-upload-outline" size={16} color="#FFFFFF" /><Text style={s.uploadTxt}>{passBgUrl ? "Change" : "Upload"}</Text></>}
            </TouchableOpacity>
            {!!passBgUrl && (
              <TouchableOpacity onPress={() => setPassBg("")} style={s.removeBtn}>
                <Text style={s.removeTxt}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={s.hint}>
            The picture behind every player's pass — upload apl-pass-bg.png. Leave it empty and the pass stays plain dark.
          </Text>
        </View>

        {/* money */}
        <Text style={s.section}>MONEY</Text>
        <View style={s.card}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label="Registration fee (₹)" value={fee} onChange={(v) => setFee(v.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="500" last />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Gateway charge (₹)" value={charge} onChange={(v) => setCharge(v.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="15" last />
            </View>
          </View>

          <View style={s.totalBox}>
            <Text style={s.totalTxt}>Player pays <Text style={{ fontWeight: "800" }}>₹{total}</Text> · you receive about <Text style={{ fontWeight: "800" }}>₹{fee || 0}</Text></Text>
          </View>
          {Number(fee) <= 20 && Number(fee) > 0 && (
            <View style={s.warnBox}>
              <Ionicons name="warning-outline" size={16} color="#B45309" />
              <Text style={s.warnTxt}>Test mode — the fee is only ₹{Number(fee)}. Set it back to 500 before telling players.</Text>
            </View>
          )}

          <View style={{ flexDirection: "row", gap: 12, marginTop: 14 }}>
            <View style={{ flex: 1 }}>
              <Field label="Team fee (₹)" value={teamFee} onChange={(v) => setTeamFee(v.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="10500" last />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="PlayOn commission (₹)" value={commission} onChange={(v) => setCommission(v.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="0" last />
            </View>
          </View>
          <Text style={s.hint}>Team fee is only shown on the screen — you collect it yourself. Commission stays 0 for your own league.</Text>
        </View>

        {/* dates */}
        <Text style={s.section}>DATES</Text>
        <View style={s.card}>
          <Text style={s.label}>Last date to register</Text>
          <TouchableOpacity style={s.dateBox} onPress={() => setPicker("last")} activeOpacity={0.85}>
            <Ionicons name="calendar-outline" size={17} color={MUTED} />
            <Text style={[s.dateTxt, !lastDate && { color: "#9CA3AF" }]}>{lastDate ? pretty(lastDate) : "Pick a date"}</Text>
            {!!lastDate && (
              <TouchableOpacity onPress={() => setLastDate("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
          <Text style={s.hint}>After this day the form closes by itself — nobody can pay.</Text>

          <Text style={[s.label, { marginTop: 16 }]}>Auction date</Text>
          <TouchableOpacity style={s.dateBox} onPress={() => setPicker("auction")} activeOpacity={0.85}>
            <Ionicons name="hammer-outline" size={17} color={MUTED} />
            <Text style={[s.dateTxt, !auctionDate && { color: "#9CA3AF" }]}>{auctionDate || "Pick a date"}</Text>
            {!!auctionDate && (
              <TouchableOpacity onPress={() => setAuctionDate("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
          <Text style={s.hint}>Shown in every player's status tracker. Leave it empty until it is fixed.</Text>
        </View>

        {/* links */}
        <Text style={s.section}>LINKS</Text>
        <View style={s.card}>
          <Field label="Instagram page" value={instagramUrl} onChange={setInstagram} placeholder="https://instagram.com/apl_amravati" autoCapitalize="none" />
          <Field label="WhatsApp group invite" value={whatsappLink} onChange={setWhatsapp} placeholder="https://chat.whatsapp.com/…" autoCapitalize="none" />
          <Field label="Your WhatsApp number (for team owners)" value={ownerWhatsapp} onChange={(v) => setOwnerWa(v.replace(/\D/g, "").slice(0, 12))} keyboardType="phone-pad" placeholder="919890844206" last />
          <Text style={s.hint}>Number with country code and no +, like 919890844206. An empty link makes that button say it is not set yet.</Text>
        </View>

        {/* switch */}
        <View style={[s.card, { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.switchTitle}>Registration open</Text>
            <Text style={s.hint}>{open ? "Players can register and pay right now." : "The form is closed — players see 'Registration closed'."}</Text>
          </View>
          <Switch value={open} onValueChange={setOpen} trackColor={{ false: "#E5E7EB", true: GREEN }} thumbColor="#FFFFFF" />
        </View>

        {/* read only */}
        <Text style={s.section}>SYSTEM</Text>
        <View style={s.card}>
          <RO label="Players registered so far" value={String(Math.max(0, nextRegNo - 1))} />
          <RO label="League owner (uid)" value={ownerId || "—"} last />
          <Text style={s.hint}>
            Only you see this count. Each player gets a random code like APL-7K2QD, so nobody can tell how many have joined.
          </Text>
        </View>
      </ScrollView>

      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={confirmSave} disabled={saving} activeOpacity={0.9}>
          {saving ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={s.saveTxt}>{exists ? "Save changes" : "Create league"}</Text>}
        </TouchableOpacity>
      </View>

      {picker && (
        <DateTimePicker
          value={(picker === "last" ? fromYmd(lastDate) : null) || new Date()}
          mode="date"
          minimumDate={new Date()}
          onChange={(e: any, d?: Date) => {
            const mode = picker;
            setPicker(null);
            if (e?.type !== "set" || !d) return;
            if (mode === "last") setLastDate(toYmd(d));
            else setAuctionDate(d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }));
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType, autoCapitalize, last }: any) {
  return (
    <View style={{ marginBottom: last ? 0 : 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType || "default"}
        autoCapitalize={autoCapitalize || "sentences"}
      />
    </View>
  );
}

function RO({ label, value, last }: any) {
  return (
    <View style={[s.roRow, last && { borderBottomWidth: 0 }]}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: { backgroundColor: DARK, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  hBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: "#263349", backgroundColor: "#141E31", alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 15.5, fontWeight: "700", color: "#FFFFFF" },
  hSub: { fontSize: 11.5, color: "#9CA3AF", marginTop: 2 },
  livePill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  livePillTxt: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5 },

  section: { fontSize: 11.5, fontWeight: "800", color: MUTED, letterSpacing: 0.7, marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 14 },
  label: { fontSize: 12.5, fontWeight: "600", color: "#374151" },
  input: { height: 46, marginTop: 7, paddingHorizontal: 13, borderWidth: 1.5, borderColor: BORDER, borderRadius: 10, fontSize: 14, color: "#111827", backgroundColor: "#FFFFFF" },
  hint: { fontSize: 11.5, color: MUTED, lineHeight: 17, marginTop: 8 },

  loadBtn: { marginTop: 7, paddingHorizontal: 18, height: 46, borderRadius: 10, backgroundColor: DARK, alignItems: "center", justifyContent: "center" },
  loadTxt: { color: "#FFFFFF", fontWeight: "700", fontSize: 13.5 },

  uploadRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  logoBox: { width: 72, height: 72, borderRadius: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: BG, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  uploadBtn: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 14, height: 44 },
  uploadTxt: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  removeBtn: { paddingHorizontal: 12, height: 44, justifyContent: "center", borderRadius: 10, borderWidth: 1.5, borderColor: "#FECACA" },
  removeTxt: { color: "#B91C1C", fontWeight: "700", fontSize: 13 },

  totalBox: { backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 10, padding: 11, marginTop: 14 },
  totalTxt: { fontSize: 12.5, color: "#14532D", lineHeight: 19 },
  warnBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: 10, padding: 11, marginTop: 8 },
  warnTxt: { flex: 1, fontSize: 12, color: "#B45309", lineHeight: 18 },

  dateBox: { flexDirection: "row", alignItems: "center", gap: 10, height: 46, marginTop: 7, paddingHorizontal: 13, borderWidth: 1.5, borderColor: BORDER, borderRadius: 10, backgroundColor: "#FFFFFF" },
  dateTxt: { flex: 1, fontSize: 14, color: "#111827", fontWeight: "600" },

  switchTitle: { fontSize: 14, fontWeight: "700", color: "#111827" },

  roRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  rowLabel: { fontSize: 12.5, color: MUTED },
  rowValue: { fontSize: 13, fontWeight: "600", color: "#111827", flexShrink: 1, textAlign: "right" },

  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: BORDER, paddingHorizontal: 16, paddingTop: 12 },
  saveBtn: { height: 52, borderRadius: 12, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  saveTxt: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
});
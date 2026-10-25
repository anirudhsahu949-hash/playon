/**
 * admin/banners.tsx — Home screen banners (replaces the banner part of Settings)
 *
 *  ✅ Exact preview: banners drawn the same way as the user Home screen
 *     (2:1, rounded, text/overlay rules) — "Preview as a player in <city>"
 *  ✅ Upload from phone (Cloudinary, utils/cloudinary.ts) or paste a link
 *  ✅ Image size check — green for 2:1, orange "edges will be cut"
 *  ✅ Tap action: nothing · app screen · a turf · website · WhatsApp · call
 *  ✅ Show in: All India · chosen cities · Coming soon cities
 *  ✅ Start now / on a date · No expiry / expires (1, 7, 15, 30 days, pick date)
 *  ✅ After expiry: delete automatically, or keep as "Ended"
 *     (expired "delete" banners are removed when this screen opens)
 *  ✅ Order (↑ ↓) = order on Home · Copy · On/Off · Delete · tap counts
 *
 * Firestore banners/{id}:
 *   image, title, subtitle, badge, date, link (what Home opens), linkType,
 *   cityIds (["all"] | city ids | "coming_soon"), order, startAt, endAt,
 *   afterExpiry ("delete" | "hide"), active, taps, imageW, imageH, createdAt, updatedAt
 * Old banners (no cityIds / order) count as All India, oldest first.
 */
import {
  View, Text, StyleSheet, StatusBar, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, RefreshControl, Image, Switch, Modal, Platform,
  KeyboardAvoidingView, Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  collection, getDocs, doc, addDoc, updateDoc, deleteDoc, writeBatch,
  serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { City, fetchCities } from "../../utils/cities";
import { pickPhotos, uploadPhoto } from "../../utils/cloudinary";

const DARK = "#0A0F1E";
const ACCENT = "#0EA5A4";
const BRAND = "#0B1220";
const GREEN = "#22C55E";
const { width: SW } = Dimensions.get("window");

// Same banner size rule as the user Home screen: 2:1.
const PREVIEW_W = SW - 32 - 24;           // inside the grey phone box
const CARD_W = SW - 32;                   // banner cards in the list

// App screens a banner can open (same routes Home already uses)
const SCREENS = [
  { label: "Refer & Earn",  route: "/refer-earn-user" },
  { label: "Explore",       route: "/(tabs)/explore" },
  { label: "Toss",          route: "/(tabs)/toss" },
  { label: "Scorer",        route: "/GullyScorer" },
  { label: "Add a Turf",    route: "/add-a-turf" },
  { label: "Refer a Venue", route: "/refer-venue" },
  { label: "Leagues",       route: "/(tabs)/leagues" },
  { label: "Wallet",        route: "/wallet" },
];

type LinkType = "none" | "screen" | "turf" | "web" | "whatsapp" | "call";
const LINK_TYPES: { key: LinkType; label: string }[] = [
  { key: "none", label: "Nothing" },
  { key: "screen", label: "App screen" },
  { key: "turf", label: "A turf" },
  { key: "web", label: "Website" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "call", label: "Call" },
];

type Banner = {
  id: string;
  image: string;
  title: string; subtitle: string; badge: string; date: string;
  link: string; linkType: LinkType;
  cityIds: string[];
  order: number;
  startAt: number | null;   // ms
  endAt: number | null;     // ms
  afterExpiry: "delete" | "hide";
  active: boolean;
  taps: number;
  imageW?: number; imageH?: number;
  createdAtMs: number;
};

type Status = "live" | "scheduled" | "ended" | "off";
const STATUS_META: Record<Status, { label: string; color: string; bg: string }> = {
  live:      { label: "Live",      color: "#15803D", bg: "#DCFCE7" },
  scheduled: { label: "Scheduled", color: "#1D4ED8", bg: "#DBEAFE" },
  ended:     { label: "Ended",     color: "#6B7280", bg: "#F3F4F6" },
  off:       { label: "Off",       color: "#B45309", bg: "#FEF3C7" },
};

// ── helpers ──────────────────────────────────────────────────────────────────
const toMs = (v: any): number | null => {
  if (!v) return null;
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (typeof v === "number") return v;
  const d = new Date(v).getTime();
  return isNaN(d) ? null : d;
};

function statusOf(b: Banner, now = Date.now()): Status {
  if (!b.active) return "off";
  if (b.endAt && b.endAt <= now) return "ended";
  if (b.startAt && b.startAt > now) return "scheduled";
  return "live";
}

// Which banners a player in this place sees — SAME rule as Home.
// place = a Live city id, or "coming_soon".
function visibleFor(b: Banner, place: string, now = Date.now()) {
  if (statusOf(b, now) !== "live") return false;
  const ids = b.cityIds.length ? b.cityIds : ["all"];
  return ids.includes("all") || ids.includes(place);
}

// Old banners only had a free-text link → guess the type for the editor
function guessLinkType(link: string): LinkType {
  const l = (link || "").trim();
  if (!l) return "none";
  if (l.startsWith("/turf/")) return "turf";
  if (l.startsWith("/")) return "screen";
  if (/wa\.me|whatsapp/i.test(l)) return "whatsapp";
  if (/^tel:/i.test(l)) return "call";
  return "web";
}

const fmtDate = (ms: number | null) => {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 0, 0); return x.getTime(); };
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const digits10 = (s: string) => s.replace(/\D/g, "").slice(-10);

function toBanner(id: string, d: any): Banner {
  const link = String(d?.link || "");
  return {
    id,
    image: String(d?.image || ""),
    title: String(d?.title || ""), subtitle: String(d?.subtitle || ""),
    badge: String(d?.badge || ""), date: String(d?.date || ""),
    link,
    linkType: (d?.linkType as LinkType) || guessLinkType(link),
    cityIds: Array.isArray(d?.cityIds) ? d.cityIds.map(String) : ["all"],
    order: typeof d?.order === "number" ? d.order : 9999,
    startAt: toMs(d?.startAt), endAt: toMs(d?.endAt),
    afterExpiry: d?.afterExpiry === "hide" ? "hide" : "delete",
    active: d?.active !== false,
    taps: Number(d?.taps || 0),
    imageW: d?.imageW, imageH: d?.imageH,
    createdAtMs: toMs(d?.createdAt) || 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BannerView — draws a banner EXACTLY like the user Home screen
// (app/(tabs)/index.tsx): 2:1, radius 18, grey skeleton while loading,
// overlay only when there is text, darker overlay when there is a title.
// ─────────────────────────────────────────────────────────────────────────────
function BannerView({ b, width }: { b: Pick<Banner, "image" | "title" | "subtitle" | "badge" | "date">; width: number }) {
  const height = Math.round(width / 2);
  const hasText = !!(b.title || b.subtitle || b.badge || b.date);
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={[bv.card, { width, height }]}>
      {!loaded && <View style={bv.skeleton} />}
      {!!b.image && (
        <Image source={{ uri: b.image }} style={bv.img} resizeMode="cover" onLoad={() => setLoaded(true)} />
      )}
      {!b.image && (
        <View style={bv.noImg}>
          <Ionicons name="image-outline" size={28} color="#9CA3AF" />
          <Text style={bv.noImgTxt}>Add an image</Text>
        </View>
      )}
      {hasText && (
        <>
          <View style={[bv.overlay, !!b.title && bv.overlayDark]} />
          <View style={bv.content}>
            {!!b.badge && <View style={bv.badge}><Text style={bv.badgeTxt}>{b.badge}</Text></View>}
            {!!b.title && <Text style={bv.title} numberOfLines={2}>{b.title}</Text>}
            {!!b.subtitle && <Text style={bv.sub} numberOfLines={2}>{b.subtitle}</Text>}
            {!!b.date && (
              <View style={bv.dateRow}>
                <Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.85)" />
                <Text style={bv.dateTxt}>{b.date}</Text>
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const bv = StyleSheet.create({
  card:     { borderRadius: 18, overflow: "hidden", backgroundColor: "#E5E7EB" },
  img:      { width: "100%", height: "100%" },
  skeleton: { ...StyleSheet.absoluteFillObject, backgroundColor: "#E5E7EB" },
  noImg:    { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 4 },
  noImgTxt: { fontSize: 12, fontWeight: "700", color: "#6B7280" },
  overlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,12,24,0.10)" },
  overlayDark: { backgroundColor: "rgba(5,12,24,0.35)" },
  content:  { position: "absolute", left: 16, right: 16, bottom: 16 },
  badge:    { alignSelf: "flex-start", backgroundColor: GREEN, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 6 },
  badgeTxt: { fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.8, textTransform: "uppercase" },
  title:    { fontSize: 20, fontWeight: "900", color: "#fff", letterSpacing: -0.3, lineHeight: 26 },
  sub:      { fontSize: 10, color: "rgba(255,255,255,0.75)", marginTop: 3 },
  dateRow:  { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  dateTxt:  { fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: "500" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Editor form
// ─────────────────────────────────────────────────────────────────────────────
type Form = {
  image: string; title: string; subtitle: string; badge: string; date: string;
  linkType: LinkType; screen: string; turfId: string; web: string; phone: string;
  allIndia: boolean; cityIds: string[];      // cityIds may include "coming_soon"
  startMode: "now" | "date"; startAt: number | null;
  expiryMode: "none" | "date"; endAt: number | null;
  afterExpiry: "delete" | "hide";
  active: boolean;
  imageW?: number; imageH?: number;
};
const EMPTY_FORM = (): Form => ({
  image: "", title: "", subtitle: "", badge: "", date: "",
  linkType: "none", screen: SCREENS[0].route, turfId: "", web: "", phone: "",
  allIndia: true, cityIds: [],
  startMode: "now", startAt: null,
  expiryMode: "none", endAt: null,
  afterExpiry: "delete",
  active: true,
});

function formFromBanner(b: Banner): Form {
  const f = EMPTY_FORM();
  const all = b.cityIds.length === 0 || b.cityIds.includes("all");
  let screen = f.screen, turfId = "", web = "", phone = "";
  if (b.linkType === "screen") screen = b.link || f.screen;
  if (b.linkType === "turf") turfId = b.link.replace(/^\/turf\//, "");
  if (b.linkType === "web") web = b.link;
  if (b.linkType === "whatsapp" || b.linkType === "call") phone = digits10(b.link);
  return {
    ...f,
    image: b.image, title: b.title, subtitle: b.subtitle, badge: b.badge, date: b.date,
    linkType: b.linkType, screen, turfId, web, phone,
    allIndia: all, cityIds: all ? [] : b.cityIds,
    startMode: b.startAt ? "date" : "now", startAt: b.startAt,
    expiryMode: b.endAt ? "date" : "none", endAt: b.endAt,
    afterExpiry: b.afterExpiry,
    active: b.active,
    imageW: b.imageW, imageH: b.imageH,
  };
}

function linkFromForm(f: Form): string {
  switch (f.linkType) {
    case "screen":   return f.screen;
    case "turf":     return f.turfId ? `/turf/${f.turfId}` : "";
    case "web":      return f.web.trim();
    case "whatsapp": return f.phone ? `https://wa.me/91${digits10(f.phone)}` : "";
    case "call":     return f.phone ? `tel:+91${digits10(f.phone)}` : "";
    default:         return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminBanners() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [banners, setBanners] = useState<Banner[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [turfs, setTurfs] = useState<{ id: string; name: string; cityName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewPlace, setPreviewPlace] = useState<string>("");   // city id | "coming_soon"
  const [previewIdx, setPreviewIdx] = useState(0);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Banner | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM());
  const [linkInput, setLinkInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [turfSearch, setTurfSearch] = useState("");
  const [picker, setPicker] = useState<null | "start" | "end">(null);

  useEffect(() => { load(); }, []);

  const load = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [bSnap, list, tSnap] = await Promise.all([
        getDocs(collection(db, "banners")),
        fetchCities(true).catch(() => [] as City[]),
        getDocs(collection(db, "turfs")).catch(() => null),
      ]);
      let all = bSnap.docs.map((d) => toBanner(d.id, d.data()));

      // ── Auto-delete: expired banners set to "Delete automatically" ──
      const now = Date.now();
      const expired = all.filter((b) => b.endAt && b.endAt <= now && b.afterExpiry === "delete");
      if (expired.length) {
        try {
          const batch = writeBatch(db);
          expired.forEach((b) => batch.delete(doc(db, "banners", b.id)));
          await batch.commit();
          all = all.filter((b) => !expired.some((x) => x.id === b.id));
        } catch { /* try again next time the screen opens */ }
      }

      all.sort((a, b) => a.order - b.order || a.createdAtMs - b.createdAtMs);
      setBanners(all);
      setCities(list);
      setTurfs((tSnap?.docs || []).map((d) => {
        const t: any = d.data();
        return { id: d.id, name: t.name || "Unnamed", cityName: t.cityName || t.location || "" };
      }));
      setPreviewPlace((p) => p || list.find((c) => c.isDefault && c.status === "live")?.id || list.find((c) => c.status === "live")?.id || "coming_soon");
      if (expired.length) {
        Alert.alert("Expired banners removed", `${expired.length} expired banner${expired.length === 1 ? " was" : "s were"} deleted automatically.`);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not load banners.");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const liveCities = useMemo(() => cities.filter((c) => c.status === "live"), [cities]);
  const counts = useMemo(() => {
    const c = { live: 0, scheduled: 0, ended: 0, off: 0, taps: 0 };
    banners.forEach((b) => { c[statusOf(b)]++; c.taps += b.taps; });
    return c;
  }, [banners]);
  const previewList = useMemo(
    () => (previewPlace ? banners.filter((b) => visibleFor(b, previewPlace)) : []),
    [banners, previewPlace],
  );
  const cityName = (id: string) =>
    id === "all" ? "All India" : id === "coming_soon" ? "Coming soon cities" : cities.find((c) => c.id === id)?.name || id;
  const linkLabel = (b: Banner) => {
    switch (b.linkType) {
      case "screen":   return `Opens: ${SCREENS.find((s) => s.route === b.link)?.label || b.link}`;
      case "turf":     return `Opens turf: ${turfs.find((t) => `/turf/${t.id}` === b.link)?.name || "turf"}`;
      case "web":      return "Opens website";
      case "whatsapp": return "Opens WhatsApp";
      case "call":     return "Calls a number";
      default:         return "No tap action";
    }
  };
  const scheduleLabel = (b: Banner) => {
    if (!b.startAt && !b.endAt) return "No expiry";
    const parts: string[] = [];
    if (b.startAt) parts.push(`From ${new Date(b.startAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`);
    if (b.endAt) parts.push(`till ${new Date(b.endAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}${b.afterExpiry === "delete" ? " · then delete" : ""}`);
    return parts.join(" ");
  };

  // ── List actions ──────────────────────────────────────────────────────────
  const saveOrder = async (list: Banner[]) => {
    const withOrder = list.map((b, i) => ({ ...b, order: i }));
    setBanners(withOrder);
    try {
      const batch = writeBatch(db);
      withOrder.forEach((b) => batch.update(doc(db, "banners", b.id), { order: b.order }));
      await batch.commit();
    } catch (e: any) { Alert.alert("Error", e?.message || "Could not save the order."); }
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= banners.length) return;
    const list = [...banners];
    [list[i], list[j]] = [list[j], list[i]];
    saveOrder(list);
  };

  const toggleActive = async (b: Banner) => {
    const next = !b.active;
    try {
      await updateDoc(doc(db, "banners", b.id), { active: next, updatedAt: serverTimestamp() });
      setBanners((prev) => prev.map((x) => (x.id === b.id ? { ...x, active: next } : x)));
    } catch (e: any) { Alert.alert("Error", e?.message || "Could not update."); }
  };

  const duplicate = async (b: Banner) => {
    try {
      setBusy(true);
      const { id, createdAtMs, taps, ...rest } = b;
      const data: any = {
        ...rest,
        title: rest.title,
        active: false,                       // copies start as drafts
        order: banners.length,
        taps: 0,
        startAt: rest.startAt ? Timestamp.fromMillis(rest.startAt) : null,
        endAt: rest.endAt ? Timestamp.fromMillis(rest.endAt) : null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);   // Firestore rejects undefined
      await addDoc(collection(db, "banners"), data);
      await load(true);
      Alert.alert("Copied", "A copy was added at the end as Off. Edit it, then switch it on.");
    } catch (e: any) { Alert.alert("Error", e?.message || "Could not copy."); }
    finally { setBusy(false); }
  };

  const remove = (b: Banner) => {
    Alert.alert("Delete banner?", `"${b.title || "Untitled banner"}" will be removed for good.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await deleteDoc(doc(db, "banners", b.id));
          setBanners((prev) => prev.filter((x) => x.id !== b.id));
          setEditorOpen(false);
        } catch (e: any) { Alert.alert("Error", e?.message || "Could not delete."); }
      } },
    ]);
  };

  // ── Editor ────────────────────────────────────────────────────────────────
  const openNew = () => {
    setEditing(null); setForm(EMPTY_FORM()); setLinkInput(""); setTurfSearch("");
    setEditorOpen(true);
  };
  const openEdit = (b: Banner) => {
    setEditing(b); setForm(formFromBanner(b)); setLinkInput(""); setTurfSearch("");
    setEditorOpen(true);
  };

  const setImage = (url: string) => {
    setForm((f) => ({ ...f, image: url, imageW: undefined, imageH: undefined }));
    if (!url) return;
    Image.getSize(url, (w, h) => setForm((f) => (f.image === url ? { ...f, imageW: w, imageH: h } : f)), () => {});
  };

  const upload = async () => {
    try {
      const picked = await pickPhotos(1);
      if (!picked.length) return;
      setUploading(true);
      const url = await uploadPhoto(picked[0], "banner");
      setImage(url);
    } catch (e: any) {
      if (e?.message === "PERMISSION") Alert.alert("Permission needed", "Allow photo access to upload a banner.");
      else Alert.alert("Upload failed", e?.message || "Please check your internet and try again.");
    } finally { setUploading(false); }
  };

  const ratio = form.imageW && form.imageH ? form.imageW / form.imageH : null;
  const ratioOk = ratio != null && Math.abs(ratio - 2) <= 0.08;

  const toggleCity = (id: string) =>
    setForm((f) => {
      const has = f.cityIds.includes(id);
      const next = has ? f.cityIds.filter((x) => x !== id) : [...f.cityIds, id];
      return { ...f, cityIds: next, allIndia: false };
    });

  const setExpiryDays = (days: number) =>
    setForm((f) => {
      const base = f.startMode === "date" && f.startAt ? new Date(f.startAt) : new Date();
      base.setDate(base.getDate() + days);
      return { ...f, expiryMode: "date", endAt: endOfDay(base) };
    });

  const validate = (): string | null => {
    if (!form.image.trim()) return "Add a banner image (upload or paste a link).";
    if (!/^https?:\/\//i.test(form.image.trim())) return "The image link must start with https://";
    if (!form.allIndia && form.cityIds.length === 0) return "Choose where to show it: All India or at least one city.";
    if (form.linkType === "turf" && !form.turfId) return "Pick the turf this banner opens.";
    if (form.linkType === "web" && !/^https?:\/\/\S+\.\S+/i.test(form.web.trim())) return "Enter a full website link (https://…).";
    if ((form.linkType === "whatsapp" || form.linkType === "call") && !/^[6-9]\d{9}$/.test(digits10(form.phone)))
      return "Enter a valid 10-digit mobile number.";
    if (form.startMode === "date" && !form.startAt) return "Pick the start date.";
    if (form.expiryMode === "date" && !form.endAt) return "Pick the expiry date.";
    if (form.expiryMode === "date" && form.endAt && form.endAt <= Date.now()) return "The expiry date is already past.";
    if (form.startMode === "date" && form.expiryMode === "date" && form.startAt && form.endAt && form.endAt <= form.startAt)
      return "Expiry must be after the start date.";
    return null;
  };

  const payload = () => {
    const cityIds = form.allIndia ? ["all"] : form.cityIds;
    return {
      image: form.image.trim(),
      title: form.title.trim(), subtitle: form.subtitle.trim(),
      badge: form.badge.trim(), date: form.date.trim(),
      linkType: form.linkType,
      link: linkFromForm(form),
      cityIds,
      startAt: form.startMode === "date" && form.startAt ? Timestamp.fromMillis(form.startAt) : null,
      endAt: form.expiryMode === "date" && form.endAt ? Timestamp.fromMillis(form.endAt) : null,
      afterExpiry: form.afterExpiry,
      active: form.active,
      ...(form.imageW && form.imageH ? { imageW: form.imageW, imageH: form.imageH } : {}),
    };
  };

  // Every save shows a confirm listing what changed
  const confirmSave = () => {
    const err = validate();
    if (err) return Alert.alert("Check this", err);
    const p = payload();
    const where = p.cityIds.map(cityName).join(", ");
    const startTxt = p.startAt ? fmtDate(p.startAt.toMillis()) : "Now";
    const endTxt = p.endAt ? `${fmtDate(p.endAt.toMillis())} · then ${p.afterExpiry === "delete" ? "delete" : "keep as Ended"}` : "No expiry";
    const lines: string[] = [];
    if (!editing) {
      lines.push(`Show in: ${where}`, `Starts: ${startTxt}`, `Expiry: ${endTxt}`,
        `Tap: ${LINK_TYPES.find((l) => l.key === p.linkType)?.label}${p.link ? ` (${p.link})` : ""}`,
        `Status: ${p.active ? "On" : "Off (draft)"}`);
    } else {
      const e = editing;
      if (p.image !== e.image) lines.push("Image: changed");
      if (p.title !== e.title) lines.push(`Title: ${p.title || "(none)"}`);
      if (p.subtitle !== e.subtitle) lines.push(`Subtitle: ${p.subtitle || "(none)"}`);
      if (p.badge !== e.badge) lines.push(`Badge: ${p.badge || "(none)"}`);
      if (p.date !== e.date) lines.push(`Date line: ${p.date || "(none)"}`);
      if (p.link !== e.link || p.linkType !== e.linkType) lines.push(`Tap: ${LINK_TYPES.find((l) => l.key === p.linkType)?.label}${p.link ? ` (${p.link})` : ""}`);
      if (p.cityIds.join(",") !== (e.cityIds.length ? e.cityIds : ["all"]).join(",")) lines.push(`Show in: ${where}`);
      if ((p.startAt?.toMillis() ?? null) !== e.startAt) lines.push(`Starts: ${startTxt}`);
      if ((p.endAt?.toMillis() ?? null) !== e.endAt || p.afterExpiry !== e.afterExpiry) lines.push(`Expiry: ${endTxt}`);
      if (p.active !== e.active) lines.push(`Status: ${p.active ? "On" : "Off"}`);
      if (lines.length === 0) { setEditorOpen(false); return; }
    }
    Alert.alert(editing ? "Save changes?" : "Publish banner?", lines.map((l) => `• ${l}`).join("\n"), [
      { text: "Cancel", style: "cancel" },
      { text: editing ? "Save" : "Publish", onPress: () => save(p) },
    ]);
  };

  const save = async (p: ReturnType<typeof payload>) => {
    setBusy(true);
    try {
      if (editing) {
        await updateDoc(doc(db, "banners", editing.id), { ...p, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, "banners"), {
          ...p, order: banners.length, taps: 0,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
      }
      setEditorOpen(false);
      await load(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save the banner.");
    } finally { setBusy(false); }
  };

  const filteredTurfs = useMemo(() => {
    const q = turfSearch.trim().toLowerCase();
    const list = q ? turfs.filter((t) => `${t.name} ${t.cityName}`.toLowerCase().includes(q)) : turfs;
    return list.slice(0, 30);
  }, [turfs, turfSearch]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.loadWrap}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={s.loadText}>Loading banners...</Text>
      </View>
    );
  }

  const previewCity = previewPlace === "coming_soon" ? null : cities.find((c) => c.id === previewPlace);

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={ACCENT} />}
      >
        {/* Hero */}
        <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
          <View style={s.heroTop}>
            <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={s.newBtn} onPress={openNew}>
              <Ionicons name="add" size={17} color="#fff" />
              <Text style={s.newBtnTxt}>New Banner</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.heroTag}>Home screen</Text>
          <Text style={s.heroTitle}>Banners</Text>
          <View style={s.stats}>
            {[
              { label: "Live", value: counts.live, color: "#34D399" },
              { label: "Scheduled", value: counts.scheduled, color: "#60A5FA" },
              { label: "Off / Ended", value: counts.off + counts.ended, color: "#9CA3AF" },
              { label: "Taps", value: counts.taps, color: "#FBBF24" },
            ].map((st) => (
              <View key={st.label} style={s.stat}>
                <Text style={[s.statVal, { color: st.color }]}>{st.value}</Text>
                <Text style={s.statLabel}>{st.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Preview as a player in … */}
        <Text style={s.label}>PREVIEW AS A PLAYER IN</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
          {[...liveCities.map((c) => ({ key: c.id, label: c.name })), { key: "coming_soon", label: "Coming soon city" }].map((p) => (
            <TouchableOpacity key={p.key} style={[s.chip, previewPlace === p.key && s.chipOn]} onPress={() => { setPreviewPlace(p.key); setPreviewIdx(0); }}>
              <Text style={[s.chipTxt, previewPlace === p.key && s.chipTxtOn]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.phone}>
          <View style={s.phoneHead}>
            <View style={s.phoneLogo} />
            <View>
              <Text style={s.phoneApp}>Playon</Text>
              <Text style={s.phoneCity}>{previewCity?.name || "Coming soon city"}</Text>
            </View>
          </View>
          {previewList.length === 0 ? (
            <View style={[s.phoneEmpty, { width: PREVIEW_W, height: PREVIEW_W / 2 }]}>
              <Text style={s.phoneEmptyTxt}>No banner — players here see no banner row</Text>
            </View>
          ) : (
            <>
              <ScrollView
                horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                style={{ width: PREVIEW_W, alignSelf: "center" }}
                onMomentumScrollEnd={(e) => setPreviewIdx(Math.round(e.nativeEvent.contentOffset.x / PREVIEW_W))}
              >
                {previewList.map((b) => <BannerView key={b.id} b={b} width={PREVIEW_W} />)}
              </ScrollView>
              {previewList.length > 1 && (
                <View style={s.dots}>
                  {previewList.map((b, i) => <View key={b.id} style={[s.dot, i === previewIdx && s.dotOn]} />)}
                </View>
              )}
            </>
          )}
          <Text style={s.phoneNote}>
            Exactly what {previewCity?.name ? `${previewCity.name} players` : "players in a coming-soon city"} see · {previewList.length} banner{previewList.length === 1 ? "" : "s"}{previewList.length > 1 ? " · swipe" : ""}
          </Text>
        </View>

        {/* List */}
        <Text style={s.label}>ALL BANNERS · ORDER HERE = ORDER ON HOME</Text>
        {banners.length === 0 && (
          <View style={s.emptyCard}>
            <Ionicons name="image-outline" size={30} color="#D1D5DB" />
            <Text style={s.emptyTitle}>No banners yet</Text>
            <TouchableOpacity style={[s.primaryBtn, { marginTop: 12, alignSelf: "stretch" }]} onPress={openNew}>
              <Text style={s.primaryTxt}>Create first banner</Text>
            </TouchableOpacity>
          </View>
        )}
        {banners.map((b, i) => {
          const st = statusOf(b);
          const meta = STATUS_META[st];
          return (
            <View key={b.id} style={s.card}>
              <View>
                <BannerView b={b} width={CARD_W} />
                <View style={[s.statusPill, { backgroundColor: meta.bg }]}><Text style={[s.statusTxt, { color: meta.color }]}>{meta.label}</Text></View>
                <View style={s.orderPill}><Text style={s.orderTxt}>#{i + 1}</Text></View>
              </View>
              <View style={s.cardBody}>
                {!!b.title && <Text style={s.cardTitle} numberOfLines={1}>{b.title}</Text>}
                <View style={s.metaRow}>
                  <View style={[s.meta, { backgroundColor: "#EFF6FF" }]}><Text style={[s.metaTxt, { color: "#1D4ED8" }]} numberOfLines={1}>{(b.cityIds.length ? b.cityIds : ["all"]).map(cityName).join(", ")}</Text></View>
                  <View style={s.meta}><Text style={s.metaTxt} numberOfLines={1}>{linkLabel(b)}</Text></View>
                  <View style={s.meta}><Text style={s.metaTxt}>{scheduleLabel(b)}</Text></View>
                  <View style={[s.meta, { backgroundColor: "#FEF3C7" }]}><Text style={[s.metaTxt, { color: "#B45309" }]}>{b.taps} tap{b.taps === 1 ? "" : "s"}</Text></View>
                </View>
                <View style={s.actions}>
                  <TouchableOpacity style={s.editBtn} onPress={() => openEdit(b)}>
                    <Ionicons name="pencil-outline" size={14} color="#fff" /><Text style={s.editTxt}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.iconBtn, i === 0 && { opacity: 0.35 }]} disabled={i === 0} onPress={() => move(i, -1)} accessibilityLabel="Move up">
                    <Ionicons name="chevron-up" size={17} color={DARK} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.iconBtn, i === banners.length - 1 && { opacity: 0.35 }]} disabled={i === banners.length - 1} onPress={() => move(i, 1)} accessibilityLabel="Move down">
                    <Ionicons name="chevron-down" size={17} color={DARK} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.iconBtn} disabled={busy} onPress={() => duplicate(b)} accessibilityLabel="Copy banner">
                    <Ionicons name="copy-outline" size={16} color={DARK} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.iconBtn, { backgroundColor: b.active ? "#FFFBEB" : "#F0FDFA" }]} onPress={() => toggleActive(b)} accessibilityLabel={b.active ? "Switch off" : "Switch on"}>
                    <Text style={{ fontSize: 12, fontWeight: "800", color: b.active ? "#B45309" : "#0F766E" }}>{b.active ? "Off" : "On"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* ══ Editor ══════════════════════════════════════════════════════════ */}
      <Modal visible={editorOpen} animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#fff" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[s.edHead, { paddingTop: insets.top + 10 }]}>
            <Text style={s.edTitle}>{editing ? "Edit Banner" : "New Banner"}</Text>
            <TouchableOpacity style={s.closeBtn} onPress={() => setEditorOpen(false)} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color="#374151" />
            </TouchableOpacity>
          </View>

          {/* Live preview — stays on top while you scroll the form */}
          <View style={s.livePreview}>
            <Text style={s.livePreviewLabel}>LIVE PREVIEW · HOW PLAYERS SEE IT</Text>
            <BannerView b={form} width={SW - 32 - 20} />
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
            {/* Image */}
            <Text style={s.fLabel}>Banner image *</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity style={[s.solidBtn, { flex: 1 }, uploading && { opacity: 0.6 }]} onPress={upload} disabled={uploading}>
                {uploading ? <ActivityIndicator color="#fff" /> : (<><Ionicons name="cloud-upload-outline" size={16} color="#fff" /><Text style={s.solidTxt}>Upload from phone</Text></>)}
              </TouchableOpacity>
              {!!form.image && (
                <TouchableOpacity style={[s.outlineBtn, { paddingHorizontal: 14 }]} onPress={() => setImage("")}>
                  <Text style={s.outlineTxt}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <TextInput
                style={[s.input, { flex: 1 }]} placeholder="…or paste image link (https://…)" placeholderTextColor="#9CA3AF"
                value={linkInput} onChangeText={setLinkInput} autoCapitalize="none" autoCorrect={false}
              />
              <TouchableOpacity style={s.useBtn} onPress={() => { if (linkInput.trim()) { setImage(linkInput.trim()); setLinkInput(""); } }}>
                <Text style={s.useTxt}>Use</Text>
              </TouchableOpacity>
            </View>
            {!!form.image && (
              ratio == null ? (
                <Text style={s.hint}>Checking image size…</Text>
              ) : ratioOk ? (
                <View style={[s.sizeBox, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}>
                  <Ionicons name="checkmark-circle" size={15} color="#15803D" />
                  <Text style={[s.sizeTxt, { color: "#15803D" }]}>{form.imageW} × {form.imageH} — perfect 2:1, nothing gets cut</Text>
                </View>
              ) : (
                <View style={[s.sizeBox, { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" }]}>
                  <Ionicons name="warning-outline" size={15} color="#C2410C" />
                  <Text style={[s.sizeTxt, { color: "#C2410C" }]}>
                    {form.imageW} × {form.imageH} — not 2:1, {ratio > 2 ? "left and right" : "top and bottom"} edges will be cut. Best size: 1200 × 600.
                  </Text>
                </View>
              )
            )}
            {!form.image && <Text style={s.hint}>Best size 1200 × 600 (2:1). Put important text in the middle.</Text>}

            {/* Text */}
            <Text style={s.fLabel}>Text on banner (optional)</Text>
            <TextInput style={s.input} placeholder="Title — leave empty if the text is in the image" placeholderTextColor="#9CA3AF"
              value={form.title} onChangeText={(v) => setForm((f) => ({ ...f, title: v }))} />
            <TextInput style={[s.input, { marginTop: 8 }]} placeholder="Subtitle" placeholderTextColor="#9CA3AF"
              value={form.subtitle} onChangeText={(v) => setForm((f) => ({ ...f, subtitle: v }))} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <TextInput style={[s.input, { flex: 1 }]} placeholder="Badge (NEW)" placeholderTextColor="#9CA3AF"
                value={form.badge} onChangeText={(v) => setForm((f) => ({ ...f, badge: v }))} />
              <TextInput style={[s.input, { flex: 1 }]} placeholder="Date line" placeholderTextColor="#9CA3AF"
                value={form.date} onChangeText={(v) => setForm((f) => ({ ...f, date: v }))} />
            </View>

            {/* Tap action */}
            <Text style={s.fLabel}>When tapped, open</Text>
            <View style={s.wrapRow}>
              {LINK_TYPES.map((l) => (
                <TouchableOpacity key={l.key} style={[s.chip, form.linkType === l.key && s.chipOn]} onPress={() => setForm((f) => ({ ...f, linkType: l.key }))}>
                  <Text style={[s.chipTxt, form.linkType === l.key && s.chipTxtOn]}>{l.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {form.linkType === "screen" && (
              <View style={[s.wrapRow, { marginTop: 8 }]}>
                {SCREENS.map((sc) => (
                  <TouchableOpacity key={sc.route} style={[s.subChip, form.screen === sc.route && s.subChipOn]} onPress={() => setForm((f) => ({ ...f, screen: sc.route }))}>
                    <Text style={[s.subChipTxt, form.screen === sc.route && { color: "#0F766E", fontWeight: "800" }]}>{sc.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {form.linkType === "turf" && (
              <View style={{ marginTop: 8 }}>
                <TextInput style={s.input} placeholder="Search turf" placeholderTextColor="#9CA3AF" value={turfSearch} onChangeText={setTurfSearch} />
                <View style={s.turfList}>
                  {filteredTurfs.map((t) => (
                    <TouchableOpacity key={t.id} style={[s.turfRow, form.turfId === t.id && { backgroundColor: "#F0FDFA" }]} onPress={() => setForm((f) => ({ ...f, turfId: t.id }))}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.turfName} numberOfLines={1}>{t.name}</Text>
                        {!!t.cityName && <Text style={s.turfCity} numberOfLines={1}>{t.cityName}</Text>}
                      </View>
                      {form.turfId === t.id && <Ionicons name="checkmark-circle" size={20} color={ACCENT} />}
                    </TouchableOpacity>
                  ))}
                  {filteredTurfs.length === 0 && <Text style={[s.hint, { padding: 12 }]}>No turf found.</Text>}
                </View>
              </View>
            )}
            {form.linkType === "web" && (
              <TextInput style={[s.input, { marginTop: 8 }]} placeholder="https://playon.fit/…" placeholderTextColor="#9CA3AF"
                value={form.web} onChangeText={(v) => setForm((f) => ({ ...f, web: v }))} autoCapitalize="none" keyboardType="url" />
            )}
            {(form.linkType === "whatsapp" || form.linkType === "call") && (
              <TextInput style={[s.input, { marginTop: 8 }]} placeholder="10-digit mobile number" placeholderTextColor="#9CA3AF"
                value={form.phone} onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))} keyboardType="phone-pad" maxLength={13} />
            )}

            {/* Cities */}
            <Text style={s.fLabel}>Show in</Text>
            <View style={s.wrapRow}>
              <TouchableOpacity style={[s.chip, form.allIndia && s.chipOn]} onPress={() => setForm((f) => ({ ...f, allIndia: true, cityIds: [] }))}>
                <Text style={[s.chipTxt, form.allIndia && s.chipTxtOn]}>All India</Text>
              </TouchableOpacity>
              {cities.filter((c) => c.status !== "hidden").map((c) => {
                const on = !form.allIndia && form.cityIds.includes(c.id);
                return (
                  <TouchableOpacity key={c.id} style={[s.chip, on && s.chipOn]} onPress={() => toggleCity(c.id)}>
                    <Text style={[s.chipTxt, on && s.chipTxtOn]}>{c.name}{c.status !== "live" ? " · soon" : ""}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity style={[s.chip, !form.allIndia && form.cityIds.includes("coming_soon") && s.chipOn]} onPress={() => toggleCity("coming_soon")}>
                <Text style={[s.chipTxt, !form.allIndia && form.cityIds.includes("coming_soon") && s.chipTxtOn]}>Coming soon cities</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.hint}>"Coming soon cities" = players in any place where PlayOn isn't live yet.</Text>

            {/* Start */}
            <Text style={s.fLabel}>Starts</Text>
            <View style={s.wrapRow}>
              <TouchableOpacity style={[s.chip, form.startMode === "now" && s.chipOn]} onPress={() => setForm((f) => ({ ...f, startMode: "now", startAt: null }))}>
                <Text style={[s.chipTxt, form.startMode === "now" && s.chipTxtOn]}>Now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.chip, form.startMode === "date" && s.chipOn]} onPress={() => { setForm((f) => ({ ...f, startMode: "date" })); setPicker("start"); }}>
                <Text style={[s.chipTxt, form.startMode === "date" && s.chipTxtOn]}>Pick date</Text>
              </TouchableOpacity>
            </View>
            {form.startMode === "date" && !!form.startAt && (
              <TouchableOpacity style={s.dateBox} onPress={() => setPicker("start")}>
                <Text style={s.dateBoxLabel}>STARTS</Text>
                <Text style={s.dateBoxVal}>{fmtDate(form.startAt)}</Text>
              </TouchableOpacity>
            )}

            {/* Expiry */}
            <Text style={s.fLabel}>Expiry</Text>
            <View style={s.wrapRow}>
              <TouchableOpacity style={[s.chip, form.expiryMode === "none" && s.chipOn]} onPress={() => setForm((f) => ({ ...f, expiryMode: "none", endAt: null }))}>
                <Text style={[s.chipTxt, form.expiryMode === "none" && s.chipTxtOn]}>No expiry</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.chip, form.expiryMode === "date" && s.chipOn]} onPress={() => { if (form.expiryMode !== "date") setExpiryDays(7); }}>
                <Text style={[s.chipTxt, form.expiryMode === "date" && s.chipTxtOn]}>Expires on a date</Text>
              </TouchableOpacity>
            </View>
            {form.expiryMode === "date" && (
              <>
                <View style={[s.wrapRow, { marginTop: 8 }]}>
                  {[1, 7, 15, 30].map((d) => (
                    <TouchableOpacity key={d} style={s.subChip} onPress={() => setExpiryDays(d)}>
                      <Text style={s.subChipTxt}>{d} day{d === 1 ? "" : "s"}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={s.subChip} onPress={() => setPicker("end")}>
                    <Text style={s.subChipTxt}>Pick date</Text>
                  </TouchableOpacity>
                </View>
                {!!form.endAt && (
                  <TouchableOpacity style={s.dateBox} onPress={() => setPicker("end")}>
                    <Text style={s.dateBoxLabel}>EXPIRES</Text>
                    <Text style={s.dateBoxVal}>{fmtDate(form.endAt)}</Text>
                  </TouchableOpacity>
                )}

                <Text style={s.fLabel}>After expiry</Text>
                {([
                  { key: "delete", title: "Delete automatically", sub: "Banner is removed for good after it expires" },
                  { key: "hide", title: "Keep it, just hide", sub: "Stays in the list as \"Ended\" so you can reuse it" },
                ] as const).map((o) => {
                  const on = form.afterExpiry === o.key;
                  return (
                    <TouchableOpacity key={o.key} style={[s.radioRow, on && { borderColor: DARK, borderWidth: 1.5 }]} onPress={() => setForm((f) => ({ ...f, afterExpiry: o.key }))}>
                      <View style={[s.radio, on && s.radioOn]} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.radioTitle}>{o.title}</Text>
                        <Text style={s.radioSub}>{o.sub}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                <Text style={s.hint}>Players stop seeing it the minute it expires, either way.</Text>
              </>
            )}

            {/* On / off */}
            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleLabel}>Show in app</Text>
                <Text style={s.toggleSub}>{form.active ? "On" : "Off — saved as a draft"}</Text>
              </View>
              <Switch value={form.active} onValueChange={(v) => setForm((f) => ({ ...f, active: v }))} trackColor={{ false: "#E5E7EB", true: ACCENT }} thumbColor="#fff" />
            </View>

            <TouchableOpacity style={[s.primaryBtn, { marginTop: 20 }, busy && { opacity: 0.6 }]} onPress={confirmSave} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryTxt}>{editing ? "Save Changes" : "Publish Banner"}</Text>}
            </TouchableOpacity>
            {editing && (
              <TouchableOpacity style={s.deleteBtn} onPress={() => remove(editing)}>
                <Ionicons name="trash-outline" size={15} color="#DC2626" />
                <Text style={s.deleteTxt}>Delete banner</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {picker && (
            <DateTimePicker
              value={new Date((picker === "start" ? form.startAt : form.endAt) || Date.now())}
              mode="date"
              minimumDate={new Date()}
              onChange={(e, d) => {
                setPicker(null);
                if (e.type !== "set" || !d) return;
                if (picker === "start") setForm((f) => ({ ...f, startMode: "date", startAt: startOfDay(d) }));
                else setForm((f) => ({ ...f, expiryMode: "date", endAt: endOfDay(d) }));
              }}
            />
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F4F8" },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText: { marginTop: 12, color: "#9CA3AF", fontSize: 15, fontWeight: "600" },

  hero: { backgroundColor: DARK, paddingHorizontal: 20, paddingBottom: 18 },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center" },
  newBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: ACCENT, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  newBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "800" },
  heroTag: { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle: { color: "#fff", fontSize: 26, fontWeight: "900", marginTop: 2 },
  stats: { flexDirection: "row", gap: 8, marginTop: 14 },
  stat: { flex: 1, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12, paddingVertical: 9, alignItems: "center" },
  statVal: { fontSize: 18, fontWeight: "900" },
  statLabel: { color: "#9CA3AF", fontSize: 10, fontWeight: "700", marginTop: 2 },

  label: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 1, marginTop: 18, marginBottom: 8, marginHorizontal: 16 },
  chipRow: { gap: 8, paddingHorizontal: 16 },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  chipOn: { backgroundColor: DARK, borderColor: DARK },
  chipTxt: { fontSize: 12, fontWeight: "700", color: "#4B5563" },
  chipTxtOn: { color: "#fff", fontWeight: "800" },
  subChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99, backgroundColor: "#F3F4F6" },
  subChipOn: { backgroundColor: "#CCFBF1" },
  subChipTxt: { fontSize: 12, fontWeight: "700", color: "#374151" },

  phone: { marginHorizontal: 16, marginTop: 10, backgroundColor: "#F5F5F5", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 22, paddingVertical: 12, alignItems: "center" },
  phoneHead: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "stretch", paddingHorizontal: 12, marginBottom: 10 },
  phoneLogo: { width: 26, height: 26, borderRadius: 7, backgroundColor: BRAND },
  phoneApp: { fontSize: 13, fontWeight: "900", color: BRAND },
  phoneCity: { fontSize: 10, fontWeight: "700", color: "#15803D" },
  phoneEmpty: { borderRadius: 18, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#CBD5E1", alignItems: "center", justifyContent: "center", padding: 16 },
  phoneEmptyTxt: { fontSize: 12, color: "#6B7280", fontWeight: "600", textAlign: "center" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 5, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#CBD5E1" },
  dotOn: { width: 18, backgroundColor: BRAND },
  phoneNote: { fontSize: 11, color: "#6B7280", marginTop: 8, paddingHorizontal: 12, textAlign: "center" },

  emptyCard: { marginHorizontal: 16, backgroundColor: "#fff", borderRadius: 16, padding: 24, alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginTop: 8 },

  card: { marginHorizontal: 16, marginBottom: 14, backgroundColor: "#fff", borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },
  statusPill: { position: "absolute", top: 10, left: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  statusTxt: { fontSize: 11, fontWeight: "800" },
  orderPill: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  orderTxt: { color: "#fff", fontSize: 11, fontWeight: "800" },
  cardBody: { padding: 12, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  meta: { backgroundColor: "#F3F4F6", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99, maxWidth: "100%" },
  metaTxt: { fontSize: 11, fontWeight: "700", color: "#374151" },
  actions: { flexDirection: "row", gap: 6 },
  editBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: DARK, paddingVertical: 10, borderRadius: 10 },
  editTxt: { color: "#fff", fontSize: 12, fontWeight: "800" },
  iconBtn: { width: 42, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F4F6", borderRadius: 10 },

  edHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 10 },
  edTitle: { fontSize: 20, fontWeight: "900", color: "#111827" },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  livePreview: { marginHorizontal: 16, backgroundColor: "#F5F5F5", borderRadius: 18, padding: 10, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 4 },
  livePreviewLabel: { fontSize: 10, fontWeight: "800", color: "#6B7280", letterSpacing: 1, marginBottom: 6, marginLeft: 2 },

  fLabel: { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 18, marginBottom: 7 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827" },
  hint: { fontSize: 11, color: "#6B7280", marginTop: 6, fontWeight: "500", lineHeight: 16 },
  solidBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: ACCENT, paddingVertical: 12, borderRadius: 12 },
  solidTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  outlineBtn: { alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#FECACA", borderRadius: 12 },
  outlineTxt: { color: "#DC2626", fontWeight: "800", fontSize: 13 },
  useBtn: { backgroundColor: DARK, borderRadius: 12, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  useTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  sizeBox: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, borderWidth: 1, borderRadius: 10, padding: 9 },
  sizeTxt: { flex: 1, fontSize: 12, fontWeight: "700" },

  turfList: { marginTop: 6, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, maxHeight: 240, overflow: "hidden" },
  turfRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  turfName: { fontSize: 14, fontWeight: "800", color: "#111827" },
  turfCity: { fontSize: 11, color: "#6B7280", marginTop: 1 },

  dateBox: { marginTop: 8, backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  dateBoxLabel: { fontSize: 10, color: "#6B7280", fontWeight: "800" },
  dateBoxVal: { fontSize: 14, fontWeight: "800", color: "#111827", marginTop: 2 },

  radioRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 8 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#9CA3AF" },
  radioOn: { borderWidth: 5, borderColor: DARK },
  radioTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  radioSub: { fontSize: 11, color: "#6B7280", marginTop: 2 },

  toggleRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, marginTop: 18, borderWidth: 1, borderColor: "#E5E7EB" },
  toggleLabel: { fontSize: 15, fontWeight: "800", color: "#111827" },
  toggleSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  primaryBtn: { backgroundColor: DARK, paddingVertical: 15, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  primaryTxt: { color: "#fff", fontWeight: "900", fontSize: 15 },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12, paddingVertical: 13, borderRadius: 14, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  deleteTxt: { color: "#DC2626", fontWeight: "800", fontSize: 14 },
});

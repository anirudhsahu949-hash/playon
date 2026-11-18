// utils/ownerQuickView.tsx  —  NEW FILE  (replaces ownerQuickView.ts — delete the .ts)
//
// 🔔 OWNER SLOT QUICK VIEW (Android only)
// ─────────────────────────────────────────────────────────────────────────────
// A notification that stays in the pull-down shade (like the music player)
// and shows today's slots of every turf:
//
//   collapsed →  "Today · 12 free · 9 booked · 3 blocked"   (only this line)
//   expanded  →  picture: selected turf's name + its counts, its REMAINING
//                slots as hour boxes (over slots hidden), legend + "Next free".
//                (9 Nov: removed the repeated lines — body line, summary
//                 line and the count pills — each fact shows once now.) The turf buttons
//                under it are the only place to switch turf
//                (≤3 turfs: one per turf · more: ◀ Prev / Next ▶).
//
// Colours (mockup): Free light green · Booked blue · Blocked orange · Over grey
//
// 🖼️ 9 Nov: the expanded card is now a PICTURE drawn in the app (same look as
//    the mockup: rounded coloured hour boxes, count chips, legend). Android
//    notifications can't draw boxes, so <OwnerQuickViewCard/> (bottom of this
//    file, placed once in owner home) draws one picture per turf off-screen,
//    saves them, and the notification shows the picture of the selected turf.
//    If the picture can't be made, it falls back to the emoji squares.
//
// HOW IT STAYS UP TO DATE
//   • Owner home (app/(owner)/index.tsx) calls refreshOwnerQuickView() every
//     time it loads its data → today's slots are saved on the phone and the
//     notification is redrawn. 0 extra Firestore reads.
//   • Tapping a turf button redraws from the saved copy (works even when the
//     app is closed — handled by the background handler at the bottom of this
//     file, registered from /index.js).
//   • "Over" slots are worked out from the clock every time it's redrawn.
//
// ON / OFF
//   • Owner Profile has a switch. Saved on the phone (AsyncStorage), default ON.
//
// 🍎 iPhone: no shade card on iOS. Instead <OwnerQuickViewCard/> saves today's
//    slots for the PlayOn Slots widget (targets/widget) via the App Group
//    "group.com.playonnew.app" and refreshes it. Owners add the widget from
//    the home screen (long-press → +).
//
// Needs:  npx expo install @notifee/react-native react-native-view-shot
//         + a new build (npx expo run:android / EAS)
// (it is native code — will NOT work in Expo Go or through an OTA update).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { Platform, View, Text, StyleSheet, AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// notifee has no web/iOS-sticky support → only load it on Android so the
// Expo web admin panel never crashes on this import.
// In Expo Go (or an old build without notifee) the native part is missing and
// require() throws "Notifee native module not found" → catch it, and the
// quick view simply switches itself off instead of crashing the app.
let notifeeMod: any = null;
if (Platform.OS === "android") {
  try {
    notifeeMod = require("@notifee/react-native");
  } catch (e) {
    console.log("Slot Quick View off: notifee native module not in this build (Expo Go?)");
    notifeeMod = null;
  }
}
const notifee: any = notifeeMod?.default ?? null;

// Picture tools (also native → guarded the same way)
let captureRef: any = null;
let FS: any = null;
if (Platform.OS === "android") {
  try { captureRef = require("react-native-view-shot").captureRef; } catch { captureRef = null; }
  try { FS = require("expo-file-system/legacy"); } catch { FS = null; }
}

export const QUICK_VIEW_SUPPORTED = Platform.OS === "android" && !!notifee;

// 🍎 iPhone widget (targets/widget) — the app hands today's slots to the widget
// through the App Group. Missing in Expo Go → just does nothing.
let ExtStorage: any = null;
if (Platform.OS === "ios") {
  try { ExtStorage = require("@bacons/apple-targets").ExtensionStorage; } catch { ExtStorage = null; }
}
const IOS_GROUP = "group.com.playonnew.app";

const NOTIF_ID    = "owner-quickview";
const CHANNEL_ID  = "owner-quickview";
const KEY_ON      = "owner_qv_on";      // "1" | "0"
const KEY_CACHE   = "owner_qv_cache";   // today's slots (JSON)
const KEY_TURF    = "owner_qv_turf";    // selected turf index
const SHOW_OVER   = false;              // true → also show slots that are over (grey)
const ACCENT      = "#15803D";

type QStatus = "free" | "booked" | "blocked";
type QSlot   = { start: number; end: number; status: QStatus };
type QTurf   = { id: string; name: string; sport?: string; slots: QSlot[] };
type QCache  = {
  dateKey: string;
  updatedAt: number;
  turfs: QTurf[];
  images?: string[];   // one picture (file:// uri) per turf, same order as turfs
};

// ── Time helpers (same logic as owner home) ──────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");

function shortTime(h: number): string {
  const hh   = ((h % 24) + 24) % 24;
  const hour = Math.floor(hh);
  const min  = Math.round((hh % 1) * 60);
  const suf  = hour >= 12 ? "PM" : "AM";
  const hr   = hour % 12 === 0 ? 12 : hour % 12;
  return min ? `${hr}:${pad(min)} ${suf}` : `${hr} ${suf}`;
}

function parseSlotToRange(slotStr: string): { start: number; end: number } | null {
  const parts = String(slotStr || "").split(" - ");
  if (parts.length < 2) return null;
  const parseT = (s: string): number => {
    const m = s.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
    if (!m) return 0;
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    const p = m[3].toUpperCase();
    if (p === "PM" && h !== 12) h += 12;
    if (p === "AM" && h === 12) h = 0;
    return h + min / 60;
  };
  const start = parseT(parts[0]);
  let end = parseT(parts[1]);
  if (end <= start) end = 24;
  return { start, end };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const overlap = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

function safeDateKey(val: any): string | null {
  if (!val) return null;
  if (typeof val?.toDate === "function") return val.toDate().toDateString();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toDateString();
}

// ── Build today's slots for every turf (pure, no Firestore) ──────────────────
function buildToday(turfs: any[], bookings: any[], blockedSlots: any[]): QCache {
  const todayKey = new Date().toDateString();

  const todayBookings = bookings.filter((b) =>
    (safeDateKey(b.date) === todayKey || b.dateString === todayKey) && b.status !== "cancelled"
  );
  const todayBlocks = blockedSlots.filter((b) => b.date === todayKey);

  const out: QTurf[] = turfs.map((turf) => {
    const open = Number(turf.openingTime ?? 6);
    let close  = Number(turf.closingTime ?? 23);
    if (close <= open) close += 24;
    const dur  = Number(turf.slotDuration ?? 60) / 60;
    const slots: QSlot[] = [];
    const sport = Array.isArray(turf.sport) ? turf.sport[0] || "" : turf.sport || "";
    if (!(dur > 0)) return { id: turf.id, name: turf.name || "Turf", sport, slots };

    const tb = todayBookings.filter((b) => b.turfId === turf.id);
    const tk = todayBlocks.filter((b) => b.turfId === turf.id);

    for (let tm = open; tm + dur <= close + 1e-6; tm += dur) {
      const end = tm + dur;
      const cs  = tm >= 24 ? tm - 24 : tm;
      const ce  = tm >= 24 ? end - 24 : Math.min(end, 24);
      const hits = (stored: string[]) =>
        stored.some((s) => {
          const r = parseSlotToRange(s);
          return r ? overlap(cs, ce, r.start, r.end) : false;
        });

      const booked = tb.some((b) =>
        hits(Array.isArray(b.selectedSlots) && b.selectedSlots.length > 0
          ? b.selectedSlots : [b.slotTime].filter(Boolean))
      );
      const blocked = !booked && tk.some((b) =>
        hits(Array.isArray(b.slots) ? b.slots : [b.slotTime].filter(Boolean))
      );
      slots.push({ start: tm, end, status: booked ? "booked" : blocked ? "blocked" : "free" });
    }
    return { id: turf.id, name: turf.name || "Turf", sport, slots };
  });

  return { dateKey: todayKey, updatedAt: Date.now(), turfs: out };
}

// ── On / Off ─────────────────────────────────────────────────────────────────
export async function isQuickViewOn(): Promise<boolean> {
  if (!QUICK_VIEW_SUPPORTED) return false;
  const v = await AsyncStorage.getItem(KEY_ON);
  return v !== "0"; // default ON
}

/** Called by the switch in Owner Profile. Returns the final state. */
export async function setQuickViewOn(on: boolean): Promise<boolean> {
  if (!QUICK_VIEW_SUPPORTED) return false;
  if (on) {
    const settings = await notifee.requestPermission();
    // AuthorizationStatus.DENIED = 0
    if (settings?.authorizationStatus === 0) {
      await AsyncStorage.setItem(KEY_ON, "0");
      return false;
    }
    await AsyncStorage.setItem(KEY_ON, "1");
    await showFromCache();
    return true;
  }
  await AsyncStorage.setItem(KEY_ON, "0");
  await hideOwnerQuickView();
  return false;
}

/** Remove the notification (switch OFF, or logout). Setting is kept. */
export async function hideOwnerQuickView() {
  if (!QUICK_VIEW_SUPPORTED) return;
  try { await notifee.cancelNotification(NOTIF_ID); } catch {}
}

// ── 🍎 iPhone widget: save today's slots for the widget and refresh it ───────
function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function syncIOSWidget(cache: QCache | null) {
  if (Platform.OS !== "ios" || !ExtStorage) return;
  try {
    const store = new ExtStorage(IOS_GROUP);
    if (!cache) {
      store.set("qv_data", "");                    // logout → widget shows "Open PlayOn"
    } else {
      store.set("qv_data", JSON.stringify({
        dateKey: localDateKey(),
        updatedAt: cache.updatedAt,
        turfs: cache.turfs.map((t) => ({
          id: t.id,
          name: t.name,
          sport: t.sport || "",
          slots: t.slots.map((x) => ({
            s: x.start,
            e: x.end,
            st: x.status === "free" ? "f" : x.status === "booked" ? "b" : "x",
          })),
        })),
      }));
    }
    ExtStorage.reloadWidget();
  } catch (e) {
    console.log("iOS widget sync failed:", e);
  }
}

/** Logout: remove notification + forget this owner's slots. */
export async function clearOwnerQuickView() {
  if (Platform.OS === "ios") { syncIOSWidget(null); return; }
  if (!QUICK_VIEW_SUPPORTED) return;
  await hideOwnerQuickView();
  await deleteOldPictures();
  await AsyncStorage.multiRemove([KEY_CACHE, KEY_TURF]);
}

// ── Text-only refresh (fallback; owner home uses <OwnerQuickViewCard/>) ─────
export async function refreshOwnerQuickView(turfs: any[], bookings: any[], blockedSlots: any[]) {
  if (!QUICK_VIEW_SUPPORTED) return;
  try {
    const cache = buildToday(turfs, bookings, blockedSlots);
    await AsyncStorage.setItem(KEY_CACHE, JSON.stringify(cache));
    await showFromCache();
  } catch (e) {
    console.log("Quick view refresh failed:", e);
  }
}

// ── Draw the notification from the saved copy ────────────────────────────────
export async function showFromCache() {
  if (!QUICK_VIEW_SUPPORTED) return;
  if (!(await isQuickViewOn())) return;

  const raw   = await AsyncStorage.getItem(KEY_CACHE);
  const cache = raw ? (JSON.parse(raw) as QCache) : null;

  await notifee.createChannel({
    id: CHANNEL_ID,
    name: "Slot quick view",
    description: "Today's free, booked and blocked slots of your turfs",
    importance: notifeeMod.AndroidImportance.LOW,      // no sound, no pop-up
    visibility: notifeeMod.AndroidVisibility.PUBLIC,
  });

  const base = {
    channelId: CHANNEL_ID,
    smallIcon: "notification_icon",                   // made by the expo-notifications plugin
    color: ACCENT,
    ongoing: true,
    autoCancel: false,
    onlyAlertOnce: true,
    pressAction: { id: "default", launchActivity: "default" },
  };

  // Nothing saved yet, or it's from another day
  if (!cache || cache.dateKey !== new Date().toDateString() || cache.turfs.length === 0) {
    await notifee.displayNotification({
      id: NOTIF_ID,
      title: "PlayOn · Today's slots",
      body: cache?.turfs.length === 0 ? "No turfs yet" : "Open PlayOn to load today's slots",
      android: base,
    });
    return;
  }

  const now  = new Date();
  const curH = now.getHours() + now.getMinutes() / 60;
  const live = (s: QSlot) => s.end > curH;                 // not over yet

  // Totals across all turfs (only slots that aren't over)
  let free = 0, booked = 0, blocked = 0;
  cache.turfs.forEach((t) => t.slots.filter(live).forEach((s) => {
    if (s.status === "free") free++; else if (s.status === "booked") booked++; else blocked++;
  }));

  let sel = Number((await AsyncStorage.getItem(KEY_TURF)) || 0);
  if (!(sel >= 0 && sel < cache.turfs.length)) sel = 0;
  const turf = cache.turfs[sel];

  const tFree    = turf.slots.filter((s) => live(s) && s.status === "free").length;
  const nextFree = turf.slots.find((s) => live(s) && s.status === "free");
  const summary  = `${turf.name}: ${tFree} free · ${nextFree ? "next free " + shortTime(nextFree.start) : "no free slot left"}`;

  // Text fallback (if the picture couldn't be made)
  const sq = (s: QSlot) =>
    !live(s) ? "⬜" : s.status === "free" ? "🟩" : s.status === "booked" ? "🟦" : "🟧";
  const shown = SHOW_OVER ? turf.slots : turf.slots.filter(live);
  const rows: string[] = [];
  for (let i = 0; i < shown.length; i += 9) rows.push(shown.slice(i, i + 9).map(sq).join(""));
  const bigText = [`<b>${esc(turf.name)}</b>`, ...rows, "🟩 Free  🟦 Booked  🟧 Blocked", `<b>${summary}</b>`].join("<br>");

  // Turf buttons: ≤3 turfs → one per turf; more → Prev / Next
  const short = (n: string) => (n.length > 12 ? n.slice(0, 11) + "…" : n);
  let actions: any[] = [];
  if (cache.turfs.length > 1 && cache.turfs.length <= 3) {
    actions = cache.turfs.map((t, i) => ({
      title: i === sel ? `● ${short(t.name)}` : short(t.name),
      pressAction: { id: `qv-turf-${i}` },
    }));
  } else if (cache.turfs.length > 3) {
    actions = [
      { title: "◀ Prev turf", pressAction: { id: "qv-prev" } },
      { title: `${sel + 1} / ${cache.turfs.length}`, pressAction: { id: "default", launchActivity: "default" } },
      { title: "Next turf ▶", pressAction: { id: "qv-next" } },
    ];
  }

  const updated = new Date(cache.updatedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

  const picture = cache.images?.[sel];
  // No summary line under the picture — the picture already says it
  const style = picture
    ? { type: notifeeMod.AndroidStyle.BIGPICTURE, picture }
    : { type: notifeeMod.AndroidStyle.BIGTEXT, text: bigText };

  await notifee.displayNotification({
    id: NOTIF_ID,
    title: `Today · ${free} free · ${booked} booked · ${blocked} blocked`,
    subtitle: `updated ${updated}`,
    // no body line — it repeated the turf name / free / next free
    android: {
      ...base,
      style,
      actions,
    },
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// 🖼️ PICTURE CARD — what the expanded notification shows (one per turf)
// Same look as the mockup card on the canvas
// ─────────────────────────────────────────────────────────────────────────────
const CARD_W = 360;
const BOX = {
  free:    { bg: "#BBF7D0", bd: "#86EFAC", tx: "#14532D" },
  booked:  { bg: "#2563EB", bd: "#2563EB", tx: "#FFFFFF" },
  blocked: { bg: "#F97316", bd: "#F97316", tx: "#FFFFFF" },
  past:    { bg: "#E5E7EB", bd: "#E5E7EB", tx: "#4B5563" },
};

// "6a", "12p", "6:30p"
function boxLabel(h: number): string {
  const hh   = ((h % 24) + 24) % 24;
  const hour = Math.floor(hh);
  const min  = Math.round((hh % 1) * 60);
  const suf  = hour >= 12 ? "p" : "a";
  const hr   = hour % 12 === 0 ? 12 : hour % 12;
  return min ? `${hr}:${pad(min)}${suf}` : `${hr}${suf}`;
}

/** One picture = the mockup card for the selected turf. */
function TurfPicture({ turfs, sel, curH }: { turfs: QTurf[]; sel: number; curH: number }) {
  const live = (s: QSlot) => s.end > curH;

  const turf     = turfs[sel];
  const left     = turf.slots.filter(live);
  const free     = left.filter((s) => s.status === "free").length;
  const booked   = left.filter((s) => s.status === "booked").length;
  const blocked  = left.filter((s) => s.status === "blocked").length;
  const nextFree = left.find((s) => s.status === "free");
  const shown    = SHOW_OVER ? turf.slots : left;

  const cols = shown.length <= 16 ? 8 : 10;
  const gap  = 4;
  const boxW = Math.floor((CARD_W - 28 - gap * (cols - 1)) / cols);

  const counts = [`${free} free`, booked ? `${booked} booked` : "", blocked ? `${blocked} blocked` : ""]
    .filter(Boolean).join(" · ");

  return (
    <View style={pc.card} collapsable={false}>
      {/* Selected turf */}
      <View style={pc.turfRow}>
        <Text style={pc.turfName} numberOfLines={1}>
          {turf.name}{turf.sport ? ` · ${turf.sport}` : ""}
        </Text>
        <Text style={pc.turfCounts}>{counts}</Text>
      </View>

      {shown.length === 0 ? (
        <Text style={pc.empty}>No slots left today</Text>
      ) : (
        <View style={[pc.grid, { gap }]}>
          {shown.map((s, i) => {
            const c   = live(s) ? BOX[s.status] : BOX.past;
            const now = s.start <= curH && curH < s.end;
            return (
              <View
                key={i}
                style={[
                  pc.box,
                  { width: boxW, backgroundColor: c.bg, borderColor: now ? "#111827" : c.bd, borderWidth: now ? 2 : 1 },
                ]}
              >
                <Text style={[pc.boxTx, { color: c.tx }]}>{boxLabel(s.start)}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Legend + next free */}
      <View style={pc.foot}>
        {[
          { c: BOX.free.bg, l: "Free" },
          { c: BOX.booked.bg, l: "Booked" },
          { c: BOX.blocked.bg, l: "Blocked" },
        ].map((x) => (
          <View key={x.l} style={pc.leg}>
            <View style={[pc.legDot, { backgroundColor: x.c }]} />
            <Text style={pc.legTx}>{x.l}</Text>
          </View>
        ))}
        <Text style={pc.next}>{nextFree ? `Next free: ${shortTime(nextFree.start)}` : "No free slot left"}</Text>
      </View>
    </View>
  );
}

const pc = StyleSheet.create({
  card:      { width: CARD_W, backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  turfRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  turfName:  { flexShrink: 1, fontSize: 16, fontWeight: "800", color: "#111827" },
  turfCounts:{ fontSize: 13, fontWeight: "600", color: "#374151" },
  grid:      { flexDirection: "row", flexWrap: "wrap" },
  box:       { height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  boxTx:     { fontSize: 12, fontWeight: "800" },
  empty:     { fontSize: 12, color: "#64748B", fontWeight: "600" },
  foot:      { flexDirection: "row", alignItems: "center", gap: 10 },
  leg:       { flexDirection: "row", alignItems: "center", gap: 4 },
  legDot:    { width: 10, height: 10, borderRadius: 3 },
  legTx:     { fontSize: 11, color: "#374151" },
  next:      { marginLeft: "auto", fontSize: 12, fontWeight: "800", color: "#111827" },
});

async function deleteOldPictures() {
  if (!FS) return;
  try {
    const raw = await AsyncStorage.getItem(KEY_CACHE);
    const old = raw ? (JSON.parse(raw) as QCache).images || [] : [];
    await Promise.all(old.map((u) => FS.deleteAsync(u, { idempotent: true }).catch(() => {})));
  } catch {}
}

/**
 * Put this ONCE in owner home (it draws nothing visible).
 * Every time the data is ready it saves today's slots, draws one picture per
 * turf off-screen, and updates the notification.
 */
export function OwnerQuickViewCard({ turfs, bookings, blockedSlots, ready }: {
  turfs: any[]; bookings: any[]; blockedSlots: any[]; ready: boolean;
}) {
  const [cache, setCache] = useState<QCache | null>(null);
  const [tick, setTick]   = useState(0);
  const refs = useRef<any[]>([]);

  // Redraw when the owner comes back to the app, and every 10 min while it's
  // open → slots that are over drop out of the picture.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") setTick((x) => x + 1); });
    const iv  = setInterval(() => setTick((x) => x + 1), 10 * 60 * 1000);
    return () => { sub.remove(); clearInterval(iv); };
  }, []);

  // 🍎 iPhone: hand today's slots to the widget (no pictures needed there)
  useEffect(() => {
    if (Platform.OS !== "ios" || !ready) return;
    syncIOSWidget(buildToday(turfs, bookings, blockedSlots));
  }, [ready, turfs, bookings, blockedSlots, tick]);
  const curH = (() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; })();

  // 1) data ready → build today's slots
  useEffect(() => {
    if (!ready || !QUICK_VIEW_SUPPORTED) return;
    let cancelled = false;
    (async () => {
      if (!(await isQuickViewOn())) return;
      const next = buildToday(turfs, bookings, blockedSlots);
      if (!cancelled) setCache(next);
    })();
    return () => { cancelled = true; };
  }, [ready, turfs, bookings, blockedSlots, tick]);

  // 2) cards drawn off-screen → take pictures → update notification
  useEffect(() => {
    if (!cache) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      let images: string[] | undefined;
      if (captureRef && FS?.documentDirectory) {
        try {
          const stamp = Date.now();     // new file names → Android never shows an old cached picture
          const made: string[] = [];
          for (let i = 0; i < cache.turfs.length; i++) {
            const tmp  = await captureRef(refs.current[i], { format: "png", quality: 1, result: "tmpfile" });
            const dest = `${FS.documentDirectory}qv-${i}-${stamp}.png`;
            await FS.copyAsync({ from: tmp, to: dest });
            made.push(dest);
          }
          images = made;
        } catch (e) {
          console.log("Quick view picture failed — using text version:", e);
          images = undefined;
        }
      }
      if (cancelled) return;
      await deleteOldPictures();
      await AsyncStorage.setItem(KEY_CACHE, JSON.stringify({ ...cache, images }));
      await showFromCache();
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cache]);

  if (!QUICK_VIEW_SUPPORTED || !cache) return null;

  // Drawn far off-screen — the owner never sees it, only the picture is used.
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: -10000, top: 0 }}>
      {cache.turfs.map((t, i) => (
        <View key={t.id} ref={(r) => { refs.current[i] = r; }} collapsable={false}>
          <TurfPicture turfs={cache.turfs} sel={i} curH={curH} />
        </View>
      ))}
    </View>
  );
}

// ── Turf button presses (app open OR closed) ─────────────────────────────────
async function handleEvent({ type, detail }: any) {
  if (type !== notifeeMod.EventType.ACTION_PRESS) return;
  const id: string = detail?.pressAction?.id || "";
  if (!id.startsWith("qv-")) return;

  const raw   = await AsyncStorage.getItem(KEY_CACHE);
  const total = raw ? (JSON.parse(raw) as QCache).turfs.length : 0;
  if (!total) return;

  let sel = Number((await AsyncStorage.getItem(KEY_TURF)) || 0);
  if (id.startsWith("qv-turf-")) sel = Number(id.replace("qv-turf-", ""));
  else if (id === "qv-next") sel = (sel + 1) % total;
  else if (id === "qv-prev") sel = (sel - 1 + total) % total;

  await AsyncStorage.setItem(KEY_TURF, String(sel));
  await showFromCache();
}

// Registered once when this file is first imported (from /index.js).
if (QUICK_VIEW_SUPPORTED && notifee) {
  notifee.onBackgroundEvent(handleEvent);
  notifee.onForegroundEvent(handleEvent);
}
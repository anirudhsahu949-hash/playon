// Settlementhelpers.ts
//
// Shared logic for the turf-day settlement / payout system.
// • A "settlement" = one turf's online money for one booking day.
// • Built on the fly from `bookings` + `turfs`. Only the "Paid" state is stored,
//   in the `settlements` collection, doc id `${turfId}_${yyyy-mm-dd}`.
//
// FIXES (Oct 2026)
// • Turf hours: turfs save openingTime / closingTime as numbers (6, 23, 26…),
//   not "HH:mm" strings — hours never showed and the day-end was wrong.
//   Both formats are supported now.
// • Late-night turfs (closingTime > 24, e.g. 2 AM) stay "Collecting" until they
//   really close, instead of turning "Pending" at midnight.
// • Future booking days are "upcoming", never "Today · In progress".
// • New per-day totals: offer discounts (by offer), hours booked, booking list.
//
// The old exports and fields are kept so the admin settlement screen keeps working.
import { auth, db } from "./firebaseConfig";
import { collection, getDocs, query, where } from "firebase/firestore";

const API_BASE_URL = "https://bookora-backend-95u4.onrender.com";

// ── Types ─────────────────────────────────────────────────────────────────
export type Booking = {
  id: string;
  turfId?: string;
  turfName?: string;
  ownerId?: string;
  date?: any;
  dateString?: string;
  status?: string;
  bookingType?: string;
  paymentStatus?: string;
  totalAmount?: number;
  paidAmount?: number;
  advanceAmount?: number;
  remainingAmount?: number;
  remainingCollected?: boolean;
  vcoinsRedeemed?: number;
  pcoinsRedeemed?: number;
  offerDiscount?: number;
  offerTitle?: string;
  offerId?: string;
  selectedSlots?: string[];
  userName?: string;
  [k: string]: any;
};

export type Turf = {
  id: string;
  name?: string;
  ownerId?: string;
  openingTime?: number | string; // 6  (hours, can be 6.5)
  closingTime?: number | string; // 23, 24 or 26 (= 2 AM next day)
  openTime?: string;             // legacy "06:00"
  closeTime?: string;            // legacy "24:00" / "00:00"
  [k: string]: any;
};

export type SettlementStatus = "upcoming" | "today" | "pending" | "paid";

export type OfferLine = { title: string; count: number; discount: number };

export type DailySettlement = {
  key: string;              // `${turfId}_${yyyy-mm-dd}` — also the Firestore doc id
  turfId: string;
  turfName: string;
  ownerId: string;
  dateKey: string;          // yyyy-mm-dd
  date: Date;               // midnight of the booking day
  amount: number;           // online collected (Razorpay, after PCoin + VCoin)
  bookingCount: number;
  bookingIds: string[];
  bookings: Booking[];      // NEW — the bookings of this turf-day
  status: SettlementStatus;
  paidAt?: Date | null;
  paidBy?: string | null;
  reference?: string | null;
  note?: string | null;
  vcoinUsed: number;        // owner's own reward — already inside `amount`
  pcoinUsed: number;        // platform-funded — added back in payoutAmount
  payoutAmount: number;     // what the owner receives = amount + pcoinUsed
  offerGiven: number;       // NEW — offer discounts this day (taken off at the turf)
  offers: OfferLine[];      // NEW — per offer
  minutesBooked: number;    // NEW — total booked minutes
  closesAt: Date | null;    // NEW — when the turf-day ends (late-night aware)
};

// ── Date / formatting helpers ───────────────────────────────────────────────
export function getSafeDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val?.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export function toMidnight(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function dateKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Booking day — dateString first (it is the day the player chose), then `date` */
export function bookingDay(b: Booking): Date | null {
  const d = getSafeDate(b.dateString) ?? getSafeDate(b.date);
  return d ? toMidnight(d) : null;
}

export function getOnlinePaid(b: Booking): number {
  return Number(b.paidAmount ?? b.advanceAmount ?? 0) || 0;
}
export function getVcoinUsed(b: Booking): number { return Number(b.vcoinsRedeemed || 0); }
export function getPcoinUsed(b: Booking): number { return Number(b.pcoinsRedeemed || 0); }
export function getOfferDiscount(b: Booking): number { return Number(b.offerDiscount || 0); }

export function fmtAmountWithVcoin(amount: number, vcoinUsed: number): string {
  if (vcoinUsed > 0) return `${Math.round(vcoinUsed)} 🪙 + ${fmtFull(amount)}`;
  return fmtFull(amount);
}

export function fmtFull(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function fmtDateDisplay(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ── Turf hours (numbers or legacy strings) ──────────────────────────────────
function hoursValue(v: any, isClose: boolean): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" && !isNaN(v)) return isClose && v === 0 ? 24 : v;
  const str = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(str)) { const n = Number(str); return isClose && n === 0 ? 24 : n; }
  const [h, m] = str.split(":");
  let val = (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
  if (isClose && val === 0) val = 24;
  return val;
}
/** Opening/closing in hours. Closing can be > 24 for late-night turfs. */
export function turfHours(t?: Turf): { open: number; close: number } {
  const open = hoursValue(t?.openingTime, false) ?? hoursValue(t?.openTime, false) ?? 6;
  const close = hoursValue(t?.closingTime, true) ?? hoursValue(t?.closeTime, true) ?? 24;
  return { open, close: close <= open ? close + 24 : close };
}

function clock(h: number): string {
  const x = ((h % 24) + 24) % 24;
  const hh = Math.floor(x), mm = Math.round((x - hh) * 60);
  const suf = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${suf}` : `${h12} ${suf}`;
}
export function fmtTurfHours(t?: Turf): string {
  if (!t) return "";
  if (t.openingTime == null && t.closingTime == null && !t.openTime && !t.closeTime) return "";
  const { open, close } = turfHours(t);
  return `${clock(open)} – ${clock(close)}`;
}

/** When a turf-day really ends (late-night turfs end after midnight). */
export function dayClosesAt(dayDate: Date, turf?: Turf): Date {
  const { close } = turfHours(turf);
  return new Date(toMidnight(dayDate).getTime() + close * 3600000);
}

/** Kept for old callers: accepts a Turf (new) or a legacy "HH:mm" close string. */
export function isDayComplete(dayDate: Date, turfOrClose?: Turf | string, now: Date = new Date()): boolean {
  const turf: Turf | undefined = typeof turfOrClose === "string"
    ? ({ id: "", closeTime: turfOrClose } as Turf)
    : turfOrClose;
  return now.getTime() >= dayClosesAt(dayDate, turf).getTime();
}

// ── Slot time helpers (late-night aware) ─────────────────────────────────────
function partMins(s: string): number {
  const m = String(s || "").trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return 0;
  let h = Number(m[1]);
  const p = m[3].toUpperCase();
  if (p === "PM" && h !== 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return h * 60 + Number(m[2] || 0);
}
/** Start/end minutes from the booking day's midnight (late-night slots go past 1440). */
export function slotRange(slots: string[] | undefined, turf?: Turf): { start: number; end: number } | null {
  if (!Array.isArray(slots) || !slots.length) return null;
  const { open, close } = turfHours(turf);
  const adj = (m: number) => (close > 24 && m < open * 60 ? m + 1440 : m);
  let start = Infinity, end = -Infinity;
  slots.forEach(s => {
    const p = String(s).split(" - ");
    if (p.length < 2) return;
    const a = adj(partMins(p[0]));
    let e = adj(partMins(p[1]));
    if (e <= a) e += 1440;
    start = Math.min(start, a); end = Math.max(end, e);
  });
  return isFinite(start) ? { start, end } : null;
}
export function fmtSlotRange(r: { start: number; end: number } | null): string {
  if (!r) return "Time not set";
  const f = (min: number) => {
    const x = ((min % 1440) + 1440) % 1440;
    const h = Math.floor(x / 60), m = x % 60;
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`;
  };
  const per = (min: number) => ((((min % 1440) + 1440) % 1440) >= 720 ? "PM" : "AM");
  return `${f(r.start)}${per(r.start) !== per(r.end) ? ` ${per(r.start)}` : ""} – ${f(r.end)} ${per(r.end)}`;
}

// ── Firestore reads ──────────────────────────────────────────────────────────
export async function fetchTurfs(ownerId?: string): Promise<Turf[]> {
  const col = collection(db, "turfs");
  const q = ownerId ? query(col, where("ownerId", "==", ownerId)) : col;
  const snap = await getDocs(q as any);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Turf));
}

export async function fetchBookingsFor(ownerId?: string): Promise<Booking[]> {
  const col = collection(db, "bookings");
  const q = ownerId ? query(col, where("ownerId", "==", ownerId)) : col;
  const snap = await getDocs(q as any);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Booking));
}

export async function fetchSettlementRecords(ownerId?: string): Promise<Record<string, any>> {
  const col = collection(db, "settlements");
  const q = ownerId ? query(col, where("ownerId", "==", ownerId)) : col;
  const snap = await getDocs(q as any);
  const map: Record<string, any> = {};
  snap.docs.forEach((d) => { map[d.id] = { id: d.id, ...(d.data() as any) }; });
  return map;
}

// ── Core aggregation ─────────────────────────────────────────────────────────
export function buildDailySettlements(
  bookings: Booking[],
  turfs: Turf[],
  paidRecords: Record<string, any>,
  now: Date = new Date(),
): DailySettlement[] {
  const turfMap: Record<string, Turf> = {};
  turfs.forEach((t) => { turfMap[t.id] = t; });

  const groups: Record<string, DailySettlement> = {};

  bookings.forEach((b) => {
    if (b.status === "cancelled") return;
    const amount = getOnlinePaid(b);
    if (amount <= 0 && getPcoinUsed(b) <= 0) return;
    const dayDate = bookingDay(b);
    if (!dayDate) return;

    const dateKey = dateKeyOf(dayDate);
    const turfId = b.turfId || "unknown";
    const key = `${turfId}_${dateKey}`;
    const turf = turfMap[turfId];

    if (!groups[key]) {
      groups[key] = {
        key, turfId,
        turfName: b.turfName || turf?.name || "Unknown Turf",
        ownerId: b.ownerId || turf?.ownerId || "",
        dateKey, date: dayDate,
        amount: 0, vcoinUsed: 0, pcoinUsed: 0, payoutAmount: 0,
        offerGiven: 0, offers: [], minutesBooked: 0,
        bookingCount: 0, bookingIds: [], bookings: [],
        status: "today", closesAt: null,
      };
    }
    const g = groups[key];
    g.amount += amount;
    g.vcoinUsed += getVcoinUsed(b);
    g.pcoinUsed += getPcoinUsed(b);
    g.bookingCount += 1;
    g.bookingIds.push(b.id);
    g.bookings.push(b);
    const r = slotRange(b.selectedSlots, turf);
    if (r) g.minutesBooked += r.end - r.start;
    const od = getOfferDiscount(b);
    if (od > 0) {
      g.offerGiven += od;
      const title = b.offerTitle || "Venue offer";
      const line = g.offers.find(o => o.title === title);
      if (line) { line.count += 1; line.discount += od; }
      else g.offers.push({ title, count: 1, discount: od });
    }
  });

  const nowMs = now.getTime();
  const todayMs = toMidnight(now).getTime();

  const list = Object.values(groups).map((g) => {
    const turf = turfMap[g.turfId];
    const closesAt = dayClosesAt(g.date, turf);
    const paidRecord = paidRecords[g.key];

    let status: SettlementStatus;
    if (paidRecord?.status === "paid") status = "paid";
    else if (nowMs >= closesAt.getTime()) status = "pending";
    else if (g.date.getTime() > todayMs) status = "upcoming";
    else status = "today"; // today, or yesterday of a late-night turf still open

    g.bookings.sort((a, b) => (slotRange(a.selectedSlots, turf)?.start ?? 0) - (slotRange(b.selectedSlots, turf)?.start ?? 0));

    return {
      ...g,
      payoutAmount: g.amount + g.pcoinUsed,
      status,
      closesAt,
      paidAt: paidRecord?.paidAt ? getSafeDate(paidRecord.paidAt) : null,
      paidBy: paidRecord?.paidBy ?? null,
      reference: paidRecord?.reference ?? null,
      note: paidRecord?.note ?? null,
    };
  });

  return list.sort((a, b) => b.date.getTime() - a.date.getTime() || a.turfName.localeCompare(b.turfName));
}

// ── Admin marks a turf-day as paid (server sends the owner notification) ─────
export async function markSettlementPaid(params: {
  key: string;
  turfId: string;
  turfName: string;
  ownerId: string;
  dateKey: string;
  date: Date;
  amount: number;   // ⚠️ pass `payoutAmount`, NOT `amount`
  bookingIds: string[];
  paidBy: string;
  reference?: string;
  note?: string;
}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not authenticated — please log in again.");

  const res = await fetch(`${API_BASE_URL}/mark-settlement-paid`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      key: params.key, turfId: params.turfId, turfName: params.turfName, ownerId: params.ownerId,
      dateKey: params.dateKey, date: params.date.toISOString(), amount: params.amount,
      bookingIds: params.bookingIds, reference: params.reference, note: params.note,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to mark settlement as paid.");
  return data;
}
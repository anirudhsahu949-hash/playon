/**
 * utils/customers.ts — Owner's saved customers
 * Firestore collection: "ownerCustomers"
 *   doc id = `${ownerId}_${phone10}`  (or `${ownerId}_n_${name-slug}` when no phone)
 *   → the same customer can never be saved twice for one owner.
 * Fields: ownerId, name, phone (10 digits or ""), note, bookingsCount,
 *         lastBookedAt, createdAt, updatedAt
 */
import { db, auth } from "../firebaseConfig";
import {
  collection, doc, getDoc, getDocs, query, where, setDoc, deleteDoc, updateDoc,
  serverTimestamp, increment, writeBatch,
} from "firebase/firestore";
import { waNumber } from "./whatsapp";

export interface Customer {
  id: string;
  ownerId: string;
  name: string;
  phone: string;        // 10 digits, or "" if not given
  note?: string;
  bookingsCount?: number;
  lastBookedAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

const COL = "ownerCustomers";

// ── Small helpers ───────────────────────────────────────────────────────────
/** Any Indian mobile format → "9876543210" ("" if invalid/empty) */
export function phone10(p?: string): string {
  const n = waNumber(p);
  return n ? n.slice(2) : "";
}
const slug = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40) || "x";

export function customerDocId(ownerId: string, name: string, phone?: string): string {
  const p = phone10(phone);
  return `${ownerId}_${p ? p : `n_${slug(name)}`}`;
}

function toMs(v: any): number {
  if (!v) return 0;
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (typeof v?.toDate === "function") return v.toDate().getTime();
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}
export const lastMs = (c: Customer) => toMs(c.lastBookedAt) || toMs(c.updatedAt) || toMs(c.createdAt);
export const byRecent = (a: Customer, b: Customer) => lastMs(b) - lastMs(a);

/** "6 bookings · last Sat" style line */
export function customerMeta(c: Customer): string {
  const n = Number(c.bookingsCount || 0);
  const parts: string[] = [n === 0 ? "No bookings yet" : `${n} booking${n === 1 ? "" : "s"}`];
  const t = toMs(c.lastBookedAt);
  if (t) {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const d1 = new Date(t); d1.setHours(0, 0, 0, 0);
    const diff = Math.round((d0.getTime() - d1.getTime()) / 86400000);
    parts.push(diff <= 0 ? "last today" : diff === 1 ? "last yesterday"
      : diff < 7 ? `last ${new Date(t).toLocaleDateString("en-US", { weekday: "short" })}`
      : `last ${new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`);
  }
  return parts.join(" · ");
}

/** Saved customer that matches what's typed: by phone if given, else by exact name */
export function findCustomer(list: Customer[], name: string, phone: string): Customer | null {
  const p = phone10(phone);
  if (p) return list.find(c => c.phone === p) || null;
  if (phone.trim()) return null; // phone typed but not valid yet
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return list.find(c => c.name.trim().toLowerCase() === n) || null;
}

/** Up to `max` customers whose name or phone contains what's typed */
export function searchCustomers(list: Customer[], text: string, max = 50): Customer[] {
  const q = text.trim().toLowerCase();
  const digits = text.replace(/\D/g, "");
  if (!q) return list.slice(0, max);
  return list.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (digits.length >= 3 && (c.phone || "").includes(digits.slice(-10)))
  ).slice(0, max);
}

// ── Firestore ───────────────────────────────────────────────────────────────
export async function listCustomers(): Promise<Customer[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const snap = await getDocs(query(collection(db, COL), where("ownerId", "==", uid)));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Customer)).sort(byRecent);
}

/**
 * Create or update a customer.
 * - countBooking: also +1 booking and set lastBookedAt (used when saving from a booking)
 * - replaceId: the old doc id when editing (if the phone changed, the old doc is moved)
 */
export async function saveCustomer(
  input: { name: string; phone?: string; note?: string },
  opts: { countBooking?: boolean; replaceId?: string } = {}
): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  const rawPhone = (input.phone || "").trim();
  const phone = phone10(rawPhone);
  if (rawPhone && !phone) throw new Error("Enter a valid 10-digit mobile number");

  const id = customerDocId(uid, name, phone);
  const ref = doc(db, COL, id);
  const existing = await getDoc(ref);

  const data: any = { ownerId: uid, name, phone, updatedAt: serverTimestamp() };
  if (input.note !== undefined) data.note = input.note.trim();
  if (!existing.exists()) { data.createdAt = serverTimestamp(); data.bookingsCount = 0; }
  if (opts.countBooking) { data.bookingsCount = increment(1); data.lastBookedAt = serverTimestamp(); }

  if (opts.replaceId && opts.replaceId !== id) {
    // Phone (or no-phone name) changed → move the doc, keep its history
    const oldRef = doc(db, COL, opts.replaceId);
    const old = await getDoc(oldRef);
    const o: any = old.exists() ? old.data() : {};
    const batch = writeBatch(db);
    batch.set(ref, {
      ...data,
      bookingsCount: existing.exists() ? increment(Number(o.bookingsCount || 0)) : Number(o.bookingsCount || 0),
      ...(o.lastBookedAt ? { lastBookedAt: o.lastBookedAt } : {}),
      createdAt: existing.exists() ? existing.data()?.createdAt ?? serverTimestamp() : o.createdAt ?? serverTimestamp(),
    }, { merge: true });
    if (old.exists()) batch.delete(oldRef);
    await batch.commit();
  } else {
    await setDoc(ref, data, { merge: true });
  }
  return id;
}

/** +1 booking for a customer who is already saved */
export async function recordCustomerBooking(id: string): Promise<void> {
  await updateDoc(doc(db, COL, id), {
    bookingsCount: increment(1), lastBookedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}

export async function deleteCustomer(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}

// ── Pick handoff: Block Slots → Customers screen → back with a customer ─────
let pickHandler: ((c: Customer) => void) | null = null;
/** Block Slots calls this right before opening the Customers screen in pick mode */
export function onCustomerPicked(fn: (c: Customer) => void) { pickHandler = fn; }
/** Customers screen calls this when the owner taps a customer */
export function emitCustomerPicked(c: Customer) { const h = pickHandler; pickHandler = null; h?.(c); }
/** Customers screen calls this if the owner leaves without picking */
export function cancelCustomerPick() { pickHandler = null; }

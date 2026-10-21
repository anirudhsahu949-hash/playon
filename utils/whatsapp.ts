/**
 * utils/whatsapp.ts — WhatsApp booking confirmations (wa.me, no API needed)
 * Used by: block-slots (after saving a walk-in) and bookings (resend button).
 */
import { Linking } from "react-native";

/** "98765 43210" / "+91 9876543210" / "09876543210" → "919876543210" (null if invalid) */
export function waNumber(phone?: string): string | null {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10 && /^[6-9]/.test(d)) return "91" + d;
  if (d.length === 11 && d.startsWith("0") && /^[6-9]/.test(d.slice(1))) return "91" + d.slice(1);
  if (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d.slice(2))) return d;
  return null;
}

const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function buildBookingMessage(o: {
  name?: string;
  turfName?: string;
  dateTxt: string;   // e.g. "Sat, 25 Oct"
  timeTxt: string;   // e.g. "7–8 PM"
  total?: number;
  paid?: number;
  due?: number;
  updated?: boolean; // true after a reschedule
}): string {
  const name = o.name && o.name !== "Walk-in" ? o.name : "there";
  const turf = o.turfName || "our turf";
  const total = Number(o.total || 0), paid = Number(o.paid || 0), due = Number(o.due || 0);
  return [
    `Hi ${name} 👋`,
    o.updated ? `Your booking at *${turf}* has been updated ✅` : `Your booking at *${turf}* is confirmed ✅`,
    ``,
    `📅 ${o.dateTxt}`,
    `⏰ ${o.timeTxt}`,
    total > 0 ? `💰 Total ${rs(total)} · Paid ${rs(paid)}${due > 0 ? ` · Due at turf ${rs(due)}` : ""}` : null,
    ``,
    `See you on the ground! ⚽`,
    `– Booked via PlayOn-turf booking app`,
    `Download now-https://play.google.com/store/apps/details?id=com.playonnew.app`
  ].filter(l => l !== null).join("\n");
}

/** Opens WhatsApp in the customer's chat with the message typed in. Returns false if it couldn't. */
export async function openWhatsApp(phone: string, text: string): Promise<boolean> {
  const num = waNumber(phone);
  if (!num) return false;
  try {
    await Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(text)}`);
    return true;
  } catch {
    return false;
  }
}

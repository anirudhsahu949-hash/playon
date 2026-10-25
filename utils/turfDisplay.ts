/**
 * utils/turfDisplay.ts — how a turf's photo and price look on every screen.
 *
 * Quick-added turfs (Admin → Quick Add Turf) may have no photo and no price:
 *   • no photo → DEFAULT_TURF_IMAGE  (change this ONE link to your own PlayOn photo)
 *   • no price → "Price on call"
 */
export const DEFAULT_TURF_IMAGE =
  "https://media.istockphoto.com/id/1405637348/photo/red-cricket-ball.jpg?s=612x612&w=0&k=20&c=DBkyp2Pp7AZOtqJrn9daux-NHl7ZwdDC5VnH8mCSZrE=";

/** First photo of the turf, or the default PlayOn photo. */
export function turfPhoto(t: any): string {
  return (Array.isArray(t?.images) && t.images.length > 0 ? t.images[0] : t?.image) || DEFAULT_TURF_IMAGE;
}

/** true when the turf has a real price (not 0 / empty). */
export function hasPrice(v: any): boolean {
  return Number(v) > 0;
}

/** "₹800" or "On call" — add "/hr" yourself where the layout needs it. */
export function priceOrCall(v: any): string {
  return hasPrice(v) ? `₹${Number(v)}` : "On call";
}

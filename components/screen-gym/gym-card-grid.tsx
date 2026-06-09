import { View, Text, TouchableOpacity, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Gym } from "../types/gym";

const BRAND      = "#0B1220";
const GYM_ACCENT = "#7C3AED";
const TINT       = "#F4F0FF";
const MUTED      = "#9CA3AF";

// ─── Amenity → Ionicon ───────────────────────────────────────────────────────
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
  "Open Space":       "expand-outline",
};
const iconFor = (a: string): keyof typeof Ionicons.glyphMap =>
  AMENITY_ICON[a] || "checkmark-circle-outline";

const shortLabel = (a: string): string => {
  const map: Record<string, string> = {
    "Personal Trainer": "Trainer",
    "Steam / Sauna":    "Steam",
    "Air Conditioned":  "AC",
    "Drinking Water":   "Water",
    "Cardio Zone":      "Cardio",
    "Yoga / Zumba":     "Yoga",
    "Locker Room":      "Lockers",
  };
  return map[a] || a;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function fmtDist(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
const getImage = (item: any): string =>
  (Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : item.image) ||
  "https://media.istockphoto.com/id/1405637348/photo/red-cricket-ball.jpg?s=612x612&w=0&k=20&c=DBkyp2Pp7AZOtqJrn9daux-NHl7ZwdDC5VnH8mCSZrE=";
const getRating = (item: any): string | null => {
  const r = parseFloat(item.rating);
  return !isNaN(r) && r > 0 ? r.toFixed(1) : null;
};
const perMonth = (p: any): number =>
  p?.months > 0 ? Math.round(p.price / p.months) : (p?.price ?? 0);

// ─── Format hour for display (e.g., 6 → "6:00 AM") ──────────────────────────
function fmtHour(h: number): string {
  if (h == null || isNaN(h)) return "";
  const hh = ((h % 24) + 24) % 24;
  const period = hh < 12 ? "AM" : "PM";
  const display = hh % 12 === 0 ? 12 : hh % 12;
  return `${display} ${period}`;
}

// ─── Build timing string (handles split vs continuous) ──────────────────────
function getTimingText(item: any): string {
  if (item.splitSessions) {
    return `${fmtHour(item.morningOpen)} – ${fmtHour(item.morningClose)} · ${fmtHour(item.eveningOpen)} – ${fmtHour(item.eveningClose)}`;
  }
  if (item.openingTime != null && item.closingTime != null) {
    return `${fmtHour(item.openingTime)} – ${fmtHour(item.closingTime)}`;
  }
  return "Hours not set";
}

// ─── GRID Card — full-width, more info, taller layout ───────────────────────
export default function GymCardGrid({
  item, userCoords, onPress,
}: {
  item: Gym;
  userCoords: { lat: number; lng: number } | null;
  onPress: () => void;
}) {
  const dist = userCoords && item.latitude != null
    ? haversine(userCoords.lat, userCoords.lng, item.latitude, item.longitude!) : null;
  const rating = getRating(item);

  const plans = Array.isArray(item.plans) ? item.plans : [];
  const sorted = [...plans].sort((a, b) => (a.months ?? 0) - (b.months ?? 0));
  const cheapest = sorted.length
    ? sorted.reduce((best, p) => (perMonth(p) < perMonth(best) ? p : best), sorted[0])
    : null;

  const amenities = Array.isArray(item.amenities) ? item.amenities : [];
  const shown = amenities.slice(0, 5);          // ✅ Grid shows MORE (5 vs 4)
  const extra = amenities.length - shown.length;

  return (
    <TouchableOpacity style={gc.card} onPress={onPress} activeOpacity={0.92}>
      {/* ── Image header (taller for grid) ── */}
      <View style={gc.imgWrap}>
        <Image source={{ uri: getImage(item) }} style={gc.img} resizeMode="cover" />
        <View style={gc.imgShade} />

        <View style={gc.gymBadge}>
          <Ionicons name="barbell" size={11} color="#fff" />
          <Text style={gc.gymBadgeTxt}>GYM</Text>
        </View>

        {dist != null && (
          <View style={gc.distBadge}>
            <Ionicons name="location" size={11} color="#fff" />
            <Text style={gc.distTxt}>{fmtDist(dist)}</Text>
          </View>
        )}

        {/* name + rating */}
        <View style={gc.imgFooter}>
          <Text numberOfLines={1} style={gc.nameOnImg}>{item.name}</Text>
          <View style={gc.imgFooterRow}>
            <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.85)" />
            <Text numberOfLines={1} style={gc.locOnImg}>{item.location || "—"}</Text>
            {rating && (
              <View style={gc.ratingPill}>
                <Ionicons name="star" size={11} color="#FBBF24" />
                <Text style={gc.ratingPillTxt}>{rating}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* ── Body ── */}
      <View style={gc.body}>
        {/* ✅ Timing row (NEW — grid has space for this) */}
       

        {/* ✅ Plans count (NEW — grid shows this) */}
        {plans.length > 0 && (
          <View style={gc.infoRow}>
            <Ionicons name="pricetags-outline" size={14} color={GYM_ACCENT} />
            <Text style={gc.infoTxt}>
              {plans.length} {plans.length === 1 ? "plan" : "plans"} available
            </Text>
          </View>
        )}

        {/* facilities with icons */}
        {shown.length > 0 && (
          <View style={gc.amenityRow}>
            {shown.map((a, i) => (
              <View key={i} style={gc.amenityChip}>
                <Ionicons name={iconFor(a)} size={13} color={GYM_ACCENT} />
                <Text style={gc.amenityTxt} numberOfLines={1}>{shortLabel(a)}</Text>
              </View>
            ))}
            {extra > 0 && (
              <View style={[gc.amenityChip, gc.amenityMore]}>
                <Text style={gc.amenityMoreTxt}>+{extra} more</Text>
              </View>
            )}
          </View>
        )}

        {/* divider */}
        <View style={gc.divider} />

        {/* price headline + CTA */}
        <View style={gc.footerRow}>
          <View>
            {cheapest ? (
              <>
                <Text style={gc.fromLabel}>Starting from</Text>
                <View style={gc.priceRow}>
                  <Text style={gc.price}>₹{perMonth(cheapest)}</Text>
                  <Text style={gc.priceUnit}>/mo</Text>
                </View>
                {cheapest.strikePrice && cheapest.strikePrice > cheapest.price && (
                  <Text style={gc.strikePrice}>₹{cheapest.strikePrice}</Text>
                )}
              </>
            ) : (
              <Text style={gc.fromLabel}>Tap to view plans</Text>
            )}
          </View>

          <TouchableOpacity style={gc.viewBtn} onPress={onPress} activeOpacity={0.85}>
            <Text style={gc.viewBtnTxt}>View Details</Text>
            <Ionicons name="arrow-forward" size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const gc = StyleSheet.create({
  card: {
    // ✅ KEY DIFFERENCE: full width (no fixed width like horizontal card)
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#EDE9FE",
    shadowColor: GYM_ACCENT,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 4,
  },

  // image header (taller for grid view)
  imgWrap:  { width: "100%", height: 180, position: "relative" },   // ✅ 200 vs 190
  img:      { width: "100%", height: "100%", backgroundColor: "#E5E7EB" },
  imgShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(11,18,32,0.28)" },

  gymBadge: {
    position: "absolute", top: 12, left: 12, flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: GYM_ACCENT, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99,
  },
  gymBadgeTxt: { fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },

  distBadge: {
    position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(11,18,32,0.7)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99,
  },
  distTxt: { fontSize: 11, fontWeight: "700", color: "#fff" },

  imgFooter:    { position: "absolute", left: 14, right: 14, bottom: 12 },
  nameOnImg:    { fontSize: 19, fontWeight: "900", color: "#fff", letterSpacing: -0.3 },
  imgFooterRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  locOnImg:     { fontSize: 12, color: "rgba(255,255,255,0.85)", fontWeight: "600", flex: 1 },
  ratingPill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99,
  },
  ratingPillTxt: { fontSize: 12, fontWeight: "800", color: "#fff" },

  // body
  body: { padding: 14 },

  // ✅ NEW: info rows (timing, plans count)
  infoRow:  { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 6 },
  infoTxt:  { fontSize: 12, color: "#374151", fontWeight: "600", flex: 1 },

  // facility chips
  amenityRow:  { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  amenityChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: TINT, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10,
  },
  amenityTxt:     { fontSize: 11, fontWeight: "700", color: GYM_ACCENT },
  amenityMore:    { backgroundColor: "#F3F4F6" },
  amenityMoreTxt: { fontSize: 11, fontWeight: "800", color: MUTED },

  // divider between info and price
  divider: { height: 1, backgroundColor: "#F3F4F6", marginTop: 12 },

  // footer price + cta
  footerRow:   { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 12 },
  fromLabel:   { fontSize: 11, color: MUTED, fontWeight: "600" },
  priceRow:    { flexDirection: "row", alignItems: "flex-end", gap: 2, marginTop: 2 },
  price:       { fontSize: 20, fontWeight: "900", color: BRAND, letterSpacing: -0.5 },
  priceUnit:   { fontSize: 13, fontWeight: "700", color: MUTED, marginBottom: 3 },
  strikePrice: { fontSize: 12, color: MUTED, textDecorationLine: "line-through", fontWeight: "600", marginTop: 2 },

  viewBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: GYM_ACCENT, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12,
  },
  viewBtnTxt: { fontSize: 13, fontWeight: "800", color: "#fff" },
});
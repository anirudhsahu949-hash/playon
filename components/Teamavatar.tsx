import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// =======================================================
// 🛡️ TEAM AVATAR — universal team badge for PlayOn Leagues
//
// Usage everywhere a team is shown (match cards, points table,
// team lists, scorer, hero carousel):
//
//   <TeamAvatar name={team.name} iconName={team.iconName} iconColor={team.iconColor} size={44} />
//
// Behaviour:
//   • If iconName + iconColor exist on the team → colored circle + white Ionicon
//   • Otherwise → colored circle + white initials, color derived
//     deterministically from the team name (same name = same color
//     everywhere in the app, nothing stored in Firestore)
//
// Also exports:
//   • TEAM_ICONS / AVATAR_COLORS — for the badge picker in host screens
//   • teamColor(name), initials(name) — reusable helpers
//   • TeamBadgePicker — the icon + color picker used when creating a team
// =======================================================

// ── Palette (matches the sport colors already used in the league world) ──────
export const AVATAR_COLORS = [
  "#7C3AED", // violet
  "#2563EB", // blue
  "#EA580C", // orange
  "#059669", // emerald
  "#D97706", // amber
  "#DC2626", // red
  "#0891B2", // cyan
  "#DB2777", // pink
  "#4F46E5", // indigo
  "#65A30D", // lime
];

// ── Icon choices for the badge picker ────────────────────────────────────────
// All are valid Ionicons glyphs shipped with @expo/vector-icons.
export const TEAM_ICONS: (keyof typeof Ionicons.glyphMap)[] = [
  "shield",
  "shield-half",
  "flame",
  "flash",
  "paw",
  "skull",
  "rocket",
  "star",
  "diamond",
  "planet",
  "thunderstorm",
  "trophy",
  "ribbon",
  "aperture",
  "compass",
  "prism",
];

// ── Helpers ──────────────────────────────────────────────────────────────────
export function initials(name: string): string {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Deterministic color from team name — same name → same color, app-wide. */
export function teamColor(name: string): string {
  const n = (name || "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < n.length; i++) {
    h = n.charCodeAt(i) + ((h << 5) - h);
    h |= 0; // keep in 32-bit range
  }
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/** True if the string is a valid Ionicons glyph name we allow. */
export function isValidTeamIcon(name?: string | null): name is keyof typeof Ionicons.glyphMap {
  return !!name && (TEAM_ICONS as string[]).includes(name);
}

// ── Component ────────────────────────────────────────────────────────────────
type TeamAvatarProps = {
  name: string;
  iconName?: string | null;
  iconColor?: string | null;
  size?: number;           // circle diameter, default 44
  style?: object;
};

export default function TeamAvatar({
  name,
  iconName,
  iconColor,
  size = 44,
  style,
}: TeamAvatarProps) {
  const hasIcon = isValidTeamIcon(iconName);
  const bg = hasIcon && iconColor ? iconColor : teamColor(name);

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
        style,
      ]}
    >
      {hasIcon ? (
        <Ionicons name={iconName} size={size * 0.5} color="#fff" />
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.36 }]}>
          {initials(name)}
        </Text>
      )}
    </View>
  );
}

// ── Badge picker (used in host-league / host-match team creation) ────────────
// Controlled component:
//   <TeamBadgePicker
//     iconName={iconName} iconColor={iconColor}
//     onChange={(icon, color) => { setIconName(icon); setIconColor(color); }}
//     previewName={teamName}
//   />
// Passing onChange(null, null) means "no badge — use initials".
type TeamBadgePickerProps = {
  iconName: string | null;
  iconColor: string | null;
  onChange: (iconName: string | null, iconColor: string | null) => void;
  previewName?: string;
};

export function TeamBadgePicker({
  iconName,
  iconColor,
  onChange,
  previewName = "",
}: TeamBadgePickerProps) {
  const activeColor = iconColor || AVATAR_COLORS[0];

  return (
    <View style={styles.pickerWrap}>
      {/* Live preview */}
      <View style={styles.previewRow}>
        <TeamAvatar
          name={previewName || "Team"}
          iconName={iconName}
          iconColor={iconColor}
          size={56}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.previewTitle}>Team badge</Text>
          <Text style={styles.previewSub}>
            {iconName ? "Icon badge selected" : "Using initials — pick an icon to customise"}
          </Text>
        </View>
        {iconName && (
          <TouchableOpacity
            onPress={() => onChange(null, null)}
            style={styles.clearBtn}
            hitSlop={8}
          >
            <Text style={styles.clearTxt}>Use initials</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Icon grid */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.iconRow}
      >
        {TEAM_ICONS.map((ic) => {
          const active = ic === iconName;
          return (
            <TouchableOpacity
              key={ic}
              style={[
                styles.iconCell,
                active && { backgroundColor: activeColor, borderColor: activeColor },
              ]}
              onPress={() => onChange(ic, activeColor)}
              activeOpacity={0.8}
            >
              <Ionicons name={ic} size={20} color={active ? "#fff" : "#4B5563"} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Color row — only meaningful once an icon is chosen */}
      {iconName && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.colorRow}
        >
          {AVATAR_COLORS.map((c) => {
            const active = c === iconColor;
            return (
              <TouchableOpacity
                key={c}
                style={[
                  styles.colorDot,
                  { backgroundColor: c },
                  active && styles.colorDotActive,
                ]}
                onPress={() => onChange(iconName, c)}
                activeOpacity={0.8}
              >
                {active && <Ionicons name="checkmark" size={14} color="#fff" />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#fff",
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  // Picker
  pickerWrap: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#F3F4F6",
    padding: 14,
    gap: 12,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  previewTitle: { fontSize: 15, fontWeight: "700", color: "#0B1220" },
  previewSub:   { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
  },
  clearTxt: { fontSize: 12, fontWeight: "700", color: "#4B5563" },

  iconRow: { gap: 8, paddingVertical: 2 },
  iconCell: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
  },

  colorRow: { gap: 8, paddingVertical: 2 },
  colorDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  colorDotActive: {
    borderWidth: 2,
    borderColor: "#0B1220",
  },
});
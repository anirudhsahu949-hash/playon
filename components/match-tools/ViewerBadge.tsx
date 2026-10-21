import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// =============================================================================
// 👁 ViewerBadge — "12 watching" pill with a soft pulse.
// Drop it anywhere: header of the match viewer, on live cards, etc.
//   <ViewerBadge count={viewerCount} />
//   <ViewerBadge count={viewerCount} dark />   ← for dark/green hero cards
// =============================================================================

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export default function ViewerBadge({
  count,
  dark = false,
  compact = false,
}: {
  count: number;
  dark?: boolean;
  compact?: boolean;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  if (count <= 0) return null;

  const fg = dark ? "#fff" : "#E11D2A";
  const bg = dark ? "rgba(255,255,255,0.18)" : "#FEF2F2";

  return (
    <View style={[st.pill, { backgroundColor: bg }, compact && st.pillCompact]}>
      <Animated.View style={{ opacity: pulse }}>
        <Ionicons name="eye" size={compact ? 11 : 13} color={fg} />
      </Animated.View>
      <Text style={[st.txt, { color: fg }, compact && st.txtCompact]}>
        {formatCount(count)} watching
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  pill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  pillCompact: { paddingHorizontal: 7, paddingVertical: 3 },
  txt:        { fontSize: 11.5, fontWeight: "800" },
  txtCompact: { fontSize: 10 },
});
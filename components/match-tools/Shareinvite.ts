import { Share, Alert } from "react-native";

// =============================================================================
// 📤 ShareInvite — one place for every share / invite message in the app.
//
// CHANGE THIS ONE LINE when your Play Store listing is live:
// =============================================================================
export const APP_STORE_LINK =
  "https://play.google.com/store/apps/details?id=com.playon.app"; // ← your package id

export const APP_NAME = "Playon Leagues";

// ── Share a live / finished match ────────────────────────────────────────────
export async function shareMatch(m: {
  teamAName?: string;
  teamBName?: string;
  scoreA?: number | string;
  scoreB?: number | string;
  leagueName?: string;
  status?: string;
  liveSummary?: string;
}) {
  const a = m.teamAName || "Team A";
  const b = m.teamBName || "Team B";
  const isLive = (m.status || "").toLowerCase() === "live";

  const lines = [
    isLive ? `🔴 LIVE NOW on ${APP_NAME}!` : `🏆 Match update from ${APP_NAME}`,
    ``,
    `${a} vs ${b}`,
    m.scoreA !== undefined && m.scoreB !== undefined ? `Score: ${m.scoreA} – ${m.scoreB}` : "",
    m.liveSummary ? `${m.liveSummary}` : "",
    m.leagueName ? `League: ${m.leagueName}` : "",
    ``,
    `Watch the live score here 👇`,
    APP_STORE_LINK,
  ].filter(Boolean);

  try {
    await Share.share({ message: lines.join("\n") });
  } catch (e: any) {
    if (e?.message) Alert.alert("Couldn't share", e.message);
  }
}

// ── Share a league (points table, fixtures) ──────────────────────────────────
export async function shareLeague(lg: {
  name?: string;
  sport?: string;
  teamsCount?: number;
}) {
  const lines = [
    `🏆 ${lg.name || "My league"} is on ${APP_NAME}!`,
    lg.sport ? `Sport: ${lg.sport}` : "",
    lg.teamsCount ? `${lg.teamsCount} teams competing` : "",
    ``,
    `Follow live scores, fixtures & the points table 👇`,
    APP_STORE_LINK,
  ].filter(Boolean);

  try {
    await Share.share({ message: lines.join("\n") });
  } catch (e: any) {
    if (e?.message) Alert.alert("Couldn't share", e.message);
  }
}

// ── Invite a friend to the app ───────────────────────────────────────────────
export async function inviteFriend() {
  const message = [
    `⚡ I'm using ${APP_NAME} to host matches, run leagues and follow live scores.`,
    ``,
    `Create your team, host your own league, and watch matches live — free.`,
    ``,
    `Join me 👇`,
    APP_STORE_LINK,
  ].join("\n");

  try {
    await Share.share({ message });
  } catch (e: any) {
    if (e?.message) Alert.alert("Couldn't share", e.message);
  }
}
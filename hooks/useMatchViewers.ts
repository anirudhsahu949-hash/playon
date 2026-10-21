import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { db, auth } from "../firebaseConfig";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

// =============================================================================
// 👁 useMatchViewers — LIVE VIEWER PRESENCE (like Crics Hero "X watching")
//
// HOW IT WORKS (no backend server needed — pure Firestore):
//   • Every person who opens a match writes a tiny "presence" doc:
//       matchViewers/{matchId}/viewers/{viewerId}  →  { lastSeen: <timestamp> }
//   • They refresh it every HEARTBEAT_MS while the screen is open.
//   • Everyone listens to that collection and counts docs whose lastSeen
//     is within STALE_MS (so people who closed the app drop off automatically
//     even if their delete never ran).
//   • On unmount / app-background, the viewer deletes their own doc.
//
// FIRESTORE RULES you must add (see the guide at the end of the chat):
//   match /matchViewers/{matchId}/viewers/{viewerId} {
//     allow read: if true;
//     allow write, delete: if request.auth != null;
//   }
// =============================================================================

const HEARTBEAT_MS = 25_000; // refresh my presence every 25s
const STALE_MS     = 65_000; // a viewer counts as "watching" if seen in last 65s

// A stable id for people who are not signed in (guest spectators).
let anonSessionId: string | null = null;
function getViewerId(): string {
  const uid = auth.currentUser?.uid;
  if (uid) return uid;
  if (!anonSessionId) {
    anonSessionId = "anon_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  return anonSessionId;
}

export function useMatchViewers(matchId: string | null | undefined, enabled: boolean = true) {
  const [viewerCount, setViewerCount] = useState<number>(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const myIdRef = useRef<string>("");

  useEffect(() => {
    if (!matchId || !enabled) return;

    const viewerId = getViewerId();
    myIdRef.current = viewerId;
    const myDoc = doc(db, "matchViewers", matchId, "viewers", viewerId);
    const viewersCol = collection(db, "matchViewers", matchId, "viewers");

    // ── 1. Announce my presence + heartbeat ──────────────────────────────
    const beat = () => {
      setDoc(myDoc, { lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
    };
    beat();
    heartbeatRef.current = setInterval(beat, HEARTBEAT_MS);

    // Pause heartbeat when app goes to background, resume + re-announce on return
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        beat();
        if (!heartbeatRef.current) heartbeatRef.current = setInterval(beat, HEARTBEAT_MS);
      } else {
        if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
        deleteDoc(myDoc).catch(() => {});
      }
    });

    // ── 2. Listen and count fresh viewers ────────────────────────────────
    const unsub = onSnapshot(
      viewersCol,
      (snap) => {
        const now = Date.now();
        let count = 0;
        snap.forEach((d) => {
          const ls = d.data()?.lastSeen;
          const ms =
            ls instanceof Timestamp ? ls.toMillis() :
            typeof ls?.toMillis === "function" ? ls.toMillis() : 0;
          // serverTimestamp is briefly null on the writer's own snapshot — count it
          if (ms === 0 || now - ms <= STALE_MS) count++;
        });
        setViewerCount(count);
      },
      () => setViewerCount(0),
    );

    // ── 3. Leave cleanly ─────────────────────────────────────────────────
    return () => {
      appSub.remove();
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      unsub();
      deleteDoc(myDoc).catch(() => {});
    };
  }, [matchId, enabled]);

  return viewerCount;
}

export default useMatchViewers;
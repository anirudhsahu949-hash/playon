import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { db, auth } from "../../firebaseConfig";
import { doc, updateDoc, getDoc } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type NotifItem = {
  id: string;
  title: string;
  body: string;
  data: Record<string, any>;
  date: number;
  read: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Global in-memory notification store
// ─────────────────────────────────────────────────────────────────────────────
let _notifications: NotifItem[] = [];
let _listeners: Array<(notifs: NotifItem[]) => void> = [];

// FIX Bug 6: moved to module scope so it survives re-renders and hot reload
const _addedIds = new Set<string>();

export function getNotifications() {
  return _notifications;
}

export function markAllRead() {
  _notifications = [];
  _listeners.forEach((l) => l([]));
}

export function clearAllNotifications() {
  _notifications = [];
  _addedIds.clear();
  _listeners.forEach((l) => l([]));
}

export function subscribeToNotifications(cb: (notifs: NotifItem[]) => void) {
  _listeners.push(cb);
  return () => {
    _listeners = _listeners.filter((l) => l !== cb);
  };
}

function addNotification(notif: Notifications.Notification) {
  const id = notif.request.identifier || Date.now().toString();

  // Deduplicate using module-level set
  if (_addedIds.has(id)) return;
  _addedIds.add(id);

  const item: NotifItem = {
    id,
    title: notif.request.content.title ?? "",
    body:  notif.request.content.body  ?? "",
    data:  (notif.request.content.data as Record<string, any>) ?? {},
    date:  notif.date || Date.now(),
    read:  false,
  };

  _notifications = [item, ..._notifications].slice(0, 50);
  _listeners.forEach((l) => l([..._notifications]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tap-to-navigate — maps the { screen, bookingId } payload server.js already
// attaches to every push into an actual in-app route.
//
// CONFIRMED against existing app code:
//   - "bookings"       → /paymentBooking/[id]   (booking-users.tsx already routes here)
//   - "owner-bookings" → /(owner)/bookings       (index.tsx already routes here)
//
// BEST-GUESS — not confirmed against your real folder structure, please check:
//   - "wallet", "refer-and-earn", "profile", "owner-gym", "owner-settlement",
//     "memberships"
// If any of these are wrong, tapping that notification type will either 404
// or silently no-op depending on expo-router's behavior — safer than doing
// nothing, but worth a 2-minute manual check on-device.
// ─────────────────────────────────────────────────────────────────────────────
function routeForNotification(data: Record<string, any>): string | null {
  const screen    = data?.screen;
  const bookingId = data?.bookingId;

  switch (screen) {
    case "bookings":
      // Booking confirmed / cancelled / rescheduled — all send this
      return bookingId ? `/paymentBooking/${bookingId}` : null;
    case "owner-bookings":
      return "/(owner)/bookings";
    case "wallet":
      return "/wallet";
    case "refer-and-earn":
      return "/refer-and-earn";
    case "profile":
      return "/profile";
    case "owner-gym":
      return "/(owner)/owner-gym";
    case "owner-settlement":
      return "/(owner)/settlementscreen";
    case "memberships":
      return "/memberships";
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One-time setup — runs once per app session at module load
// ─────────────────────────────────────────────────────────────────────────────
let notificationHandlerSet = false;

// FIX Bug 1: REMOVED module-level listenerRegistered flag entirely.
// It was never reset after logout, so the second login would skip all
// listener registration. The useEffect cleanup (return () => {...}) already
// removes listeners on unmount — no double-register risk without the flag.

if (!notificationHandlerSet) {
  notificationHandlerSet = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList:   true,
      shouldPlaySound:  true,
      shouldSetBadge:   false,
    }),
  });

  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("bookora-default", {
      name:             "Bookora Notifications",
      importance:       Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor:       "#000000",
      sound:            "default",
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main hook
// ─────────────────────────────────────────────────────────────────────────────
export function usePushNotifications() {
  const router = useRouter();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener     = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    // FIX Bug 1: No listenerRegistered guard here anymore.
    // Every mount (including after logout/login) correctly registers listeners.
    // Cleanup below removes them on unmount, so no duplicates can occur.

    // FIX Bug 2: Drive token registration from auth state, not a blind timer.
    // onAuthStateChanged fires as soon as Firebase auth is ready — no guessing.
    // We pass uid directly so registerForPushNotifications never needs to wait
    // for auth internally. On logout (user = null) we clear the stale token.
    const unsubAuth = auth.onAuthStateChanged((user) => {
      if (user) {
        registerForPushNotifications(user.uid);
      } else {
        clearPushToken();
      }
    });

    // navDelayMs: cold-start opens (app was killed, user tapped the push to
    // launch it) fire getLastNotificationResponseAsync() before the root
    // navigator has necessarily finished mounting — router.push() that early
    // can silently no-op. A live tap (app already running) doesn't need the
    // delay since the navigator's already up, but a small delay there too is
    // harmless and keeps this function's behavior consistent either way.
    const addNotifFromResponse = (
      response: Notifications.NotificationResponse,
      navDelayMs: number = 0
    ) => {
      const n  = response.notification;
      const id = n.request.identifier || Date.now().toString();

      // FIX Bug 6: use module-level _addedIds, not a local Set that resets
      if (_addedIds.has(id)) return;
      _addedIds.add(id);

      const data = (n.request.content.data as Record<string, any>) ?? {};

      const notifItem: NotifItem = {
        id,
        title: n.request.content.title ?? "",
        body:  n.request.content.body  ?? "",
        data,
        date:  Date.now(),
        read:  false,
      };

      _notifications = [notifItem, ..._notifications].slice(0, 50);
      _listeners.forEach((l) => l([..._notifications]));

      // ── Tap-to-navigate ──────────────────────────────────────────────
      const target = routeForNotification(data);
      if (target) {
        setTimeout(() => {
          try {
            router.push(target as any);
          } catch (e) {
            console.warn("⚠️ Notification navigation failed:", e);
          }
        }, navDelayMs);
      }
    };

    // Capture notification that opened app from killed/background state
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response?.notification) {
          addNotifFromResponse(response, 400); // cold start — give the navigator time to mount
        }
      })
      .catch(() => {}); // suppress deprecation errors safely

    // Foreground notification received
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("🔔 Notification received:", notification.request.content.title);
        addNotification(notification);
      }
    );

    // User tapped notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log("👆 Notification tapped:", response.notification.request.content.title);
        addNotifFromResponse(response, 0); // app already running — navigate immediately
      }
    );

    return () => {
      unsubAuth();
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [router]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Register device and save Expo push token to Firestore
//
// FIX Bug 2: uid is now passed in directly from onAuthStateChanged.
// No more internal auth waiting — we know the user is ready before we start.
// Retries up to 3 times for SERVICE_NOT_AVAILABLE (FCM flakiness on Android).
// ─────────────────────────────────────────────────────────────────────────────
async function registerForPushNotifications(uid: string, retryCount = 0): Promise<void> {
  await Notifications.setBadgeCountAsync(0).catch(() => {});

  // Must be a real physical device
  if (!Device.isDevice) {
    console.log("⚠️ Push notifications require a real device — skipping.");
    return;
  }

  // Check / request permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("❌ Push notification permission denied.");
    return;
  }

  // Get EAS project ID
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.error("❌ No EAS projectId found in app config.");
    return;
  }

  try {
    // Get Expo push token (used for all normal notifications)
    const tokenData     = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenData.data;
    console.log("✅ Expo push token:", expoPushToken);

    // BUG 5 FIX: Also get the native FCM device token.
    // Expo Push API ignores imageUrl silently — it has no image support.
    // Firebase Admin SDK messaging().send() supports imageUrl natively,
    // but it needs the raw FCM token, not the Expo wrapper token.
    // We save both so the server can choose which to use.
    let fcmToken: string | null = null;
    if (Platform.OS === "android") {
      try {
        const deviceToken = await Notifications.getDevicePushTokenAsync();
        fcmToken = deviceToken.data as string;
        console.log("✅ FCM device token:", fcmToken);
      } catch (e: any) {
        // Non-fatal — image notifications just won't work on this device
        console.warn("⚠️ Could not get FCM device token:", e?.message);
      }
    }

    // uid is already confirmed — no waiting needed
    const userRef  = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      console.warn("⚠️ User document not found in Firestore.");
      return;
    }

    const existingData  = userSnap.data();
    const existingExpo  = existingData?.expoPushToken;
    const existingFcm   = existingData?.fcmToken;
    const tokensChanged = existingExpo !== expoPushToken || existingFcm !== fcmToken;

    if (tokensChanged) {
      await updateDoc(userRef, {
        expoPushToken,
        fcmToken:           fcmToken ?? null,
        pushTokenUpdatedAt: new Date().toISOString(),
        platform:           Platform.OS,
      });
      console.log("✅ Push tokens saved to Firestore.");
    } else {
      console.log("ℹ️ Push tokens unchanged — skipping Firestore update.");
    }

  } catch (e: any) {
    // ── Retry logic for Android FCM SERVICE_NOT_AVAILABLE ──────────────
    const isServiceUnavailable =
      e?.message?.includes("SERVICE_NOT_AVAILABLE") ||
      e?.message?.includes("ExecutionException") ||
      e?.message?.includes("IOException");

    if (isServiceUnavailable && retryCount < 3) {
      const delayMs = (retryCount + 1) * 4000; // 4s → 8s → 12s
      console.warn(
        `⚠️ FCM SERVICE_NOT_AVAILABLE. Retrying in ${delayMs / 1000}s... ` +
        `(attempt ${retryCount + 1} of 3)`
      );
      setTimeout(() => registerForPushNotifications(uid, retryCount + 1), delayMs);
      return;
    }

    // After 3 retries or unknown error — log and give up gracefully
    console.error("❌ Failed to get/save push token after retries:", e?.message ?? e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Clear push token from Firestore on logout
// Prevents sending notifications to a device after the user signs out
// ─────────────────────────────────────────────────────────────────────────────
async function clearPushToken(): Promise<void> {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const userRef = doc(db, "users", currentUser.uid);
    await updateDoc(userRef, {
      expoPushToken:      null,
      fcmToken:           null,   // BUG 5 FIX: also clear FCM token on logout
      pushTokenUpdatedAt: new Date().toISOString(),
    });
    console.log("✅ Push tokens cleared from Firestore on logout.");
  } catch (e: any) {
    // Non-fatal — user may already be signed out of Firestore
    console.warn("⚠️ Could not clear push token on logout:", e?.message ?? e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider component — mount once in your root _layout.tsx
// ─────────────────────────────────────────────────────────────────────────────
export default function NotificationProvider() {
  usePushNotifications();
  return null;
}
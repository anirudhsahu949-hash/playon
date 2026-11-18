/**
 * utils/alert.ts — makes React Native's Alert.alert work on the WEB.
 *
 * Problem: on web (react-native-web) Alert.alert() does NOTHING — no popup,
 * and button onPress callbacks never run. So on the web admin panel:
 *   • validation errors ("Pick the city…") are silent → "Add Turf" seems dead
 *   • confirm dialogs ("Add this turf?" → Add) never call save() → nothing saved
 *   • Delete / Logout / Approve confirms never run
 *
 * Fix: on web only, replace Alert.alert with browser dialogs:
 *   • 0–1 button            → window.alert, then that button's onPress
 *   • Cancel + 1 action      → window.confirm (OK = action, Cancel = cancel)
 *   • 2+ actions             → window.prompt with a numbered list
 * Android / iOS are untouched.
 *
 * Imported once at the very top of app/_layout.tsx — no other file changes needed.
 */
import { Alert, Platform } from "react-native";
import type { AlertButton } from "react-native";

if (Platform.OS === "web" && typeof window !== "undefined") {
  (Alert as any).alert = (
    title?: string,
    message?: string,
    buttons?: AlertButton[],
  ) => {
    const text = [title, message].filter(Boolean).join("\n\n");
    const btns = (buttons ?? []).filter(Boolean);

    // Run after the dialog closes so React state updates aren't swallowed
    const run = (b?: AlertButton) => { if (b?.onPress) setTimeout(() => b.onPress!(), 0); };

    if (btns.length <= 1) {
      window.alert(text);
      run(btns[0]);
      return;
    }

    const cancel = btns.find((b) => b.style === "cancel");
    const actions = btns.filter((b) => b !== cancel);

    if (actions.length === 1) {
      if (window.confirm(text)) run(actions[0]);
      else run(cancel);
      return;
    }

    const list = actions.map((b, i) => `${i + 1}. ${b.text ?? "Option"}`).join("\n");
    const ans = window.prompt(`${text}\n\n${list}\n\nType the number of your choice:`);
    const idx = Number(ans) - 1;
    if (ans != null && actions[idx]) run(actions[idx]);
    else run(cancel);
  };
}

export {};

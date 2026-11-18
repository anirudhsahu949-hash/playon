/**
 * utils/cloudinary.ts — pick photos, shrink them, upload to Cloudinary.
 *
 * Used by the Add a Turf / List Your Turf form (app/list-turf.tsx),
 * admin Quick Add (add-listing.tsx) and admin Banners.
 *
 * Needs (run once in the project folder, then make a new build):
 *   npx expo install expo-image-picker expo-image-manipulator
 *
 * Cloudinary setup (already done):
 *   Cloud name:    ptaivw9h
 *   Upload preset: playon_turf  (Unsigned, folder playon/turfs)
 * These two values are NOT secrets — never put the API Secret in the app.
 *
 * WEB FIX: on web the photo is a blob:/data: link, and FormData can't take
 * { uri, type, name } like on phones — it needs a real Blob. uploadPhoto now
 * converts the photo to a Blob on web, so uploads work in the browser too.
 */
import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

export const CLOUDINARY_CLOUD_NAME = "ptaivw9h";
export const CLOUDINARY_UPLOAD_PRESET = "playon_turf";
const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

// A phone photo is 3–5 MB. Shrinking to 1280 px wide at 70% quality makes it
// ~150–250 KB — fast to upload on 4G and plenty sharp for a turf photo.
const MAX_WIDTH = 1280;
const QUALITY = 0.7;

/**
 * Opens the gallery so the user can pick up to `max` photos.
 * Returns local photo URIs (empty array if cancelled or permission denied).
 */
export async function pickPhotos(max: number): Promise<string[]> {
  if (max <= 0) return [];
  if (Platform.OS !== "web") {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error("PERMISSION");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: max > 1,
    selectionLimit: max,
    quality: 1,           // we compress ourselves below
    exif: false,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, max).map((a) => a.uri);
}

/** Opens the camera to take one photo. Returns its URI, or null if cancelled. */
export async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("PERMISSION");
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false });
  if (result.canceled) return null;
  return result.assets[0]?.uri ?? null;
}

/** Shrinks a photo to MAX_WIDTH and re-saves it as JPEG. Returns the new URI. */
async function shrink(uri: string): Promise<string> {
  try {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MAX_WIDTH } }],
      { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );
    return out.uri;
  } catch {
    return uri; // if shrinking fails, upload the original rather than nothing
  }
}

/**
 * Shrinks and uploads one photo. Returns the permanent https link.
 * Throws if the upload fails (no internet, Cloudinary error).
 */
export async function uploadPhoto(uri: string, tag = "turf-request"): Promise<string> {
  const small = await shrink(uri);
  const fileName = `turf_${Date.now()}.jpg`;

  const form = new FormData();
  if (Platform.OS === "web") {
    // Browser: turn the blob:/data: link into a real file
    const blob = await (await fetch(small)).blob();
    form.append("file", blob, fileName);
  } else {
    form.append("file", { uri: small, type: "image/jpeg", name: fileName } as any);
  }
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  form.append("tags", tag);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(UPLOAD_URL, { method: "POST", body: form, signal: controller.signal });
    const data = await res.json();
    if (!res.ok || !data?.secure_url) {
      throw new Error(data?.error?.message || "Upload failed");
    }
    return data.secure_url as string;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Smaller, faster version of a Cloudinary photo for cards and lists.
 * Non-Cloudinary links are returned unchanged.
 *   cldThumb(url)       → 600 px wide, auto quality/format
 *   cldThumb(url, 300)  → 300 px wide
 */
export function cldThumb(url: string, width = 600): string {
  if (!url || !url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/w_${width},c_limit,q_auto,f_auto/`);
}

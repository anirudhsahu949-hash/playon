/**
 * app/city-picker.tsx — City Picker screen (opened from Home header + Profile).
 *
 *  • No search      → list of Live cities (with turf counts), current one ticked
 *  • Search "nag"   → Live + Coming soon PlayOn cities first, then every matching
 *                     Indian city/town (utils/indiaCities.ts, offline) → "coming soon"
 *  • Live city      → selected: shows all its turfs (nearest first) + "Show <city> on Home"
 *  • Not live       → "PlayOn is coming to <city>": Notify me · Add a turf · nearest live city
 *  • Use my current location → exact GPS (saved for Home distances) + finds the city
 *
 * Optional params: ?q=Pune  (prefill the search, e.g. a player who signed up in Pune)
 */
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Image,
  ActivityIndicator, Alert, Linking, StatusBar,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { collection, getDocs, query, where, doc, setDoc } from "firebase/firestore";
import { db, auth } from "../firebaseConfig";
import {
  City, fetchCities, getSavedCity, saveCityChoice, resolveCity, nearestCity,
  joinCityWaitlist, markCityAsked, saveCoords, getSavedCoords, haversineKm, saveNotLiveCity,
} from "../utils/cities";
import { searchIndiaCities } from "../utils/indiaCities";
import { DEFAULT_TURF_IMAGE, hasPrice } from "../utils/turfDisplay";

const BRAND = "#0B1220";
const GREEN = "#15803D";
const FALLBACK_IMG = DEFAULT_TURF_IMAGE;

const SPORT_COLOR: Record<string, string> = {
  Football: "#0B1220", Cricket: "#16A34A", Badminton: "#7C3AED", Basketball: "#EA580C",
  Tennis: "#65A30D", Volleyball: "#0EA5E9", Pickleball: "#0891B2", Swimming: "#0284C7",
};

const getSports = (t: any): string[] => {
  const raw: string[] = Array.isArray(t?.sport)
    ? t.sport.flatMap((s: any) => String(s).split(","))
    : typeof t?.sport === "string" ? t.sport.split(",") : [];
  const out: string[] = [];
  raw.forEach((r) => {
    const x = r.trim();
    if (!x) return;
    const n = x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
    if (!out.includes(n)) out.push(n);
  });
  return out;
};
const turfImage = (t: any) =>
  (Array.isArray(t.images) && t.images.length > 0 ? t.images[0] : t.image) || FALLBACK_IMG;
const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

type Soon = { name: string; lat: number | null; lng: number | null; nearest: { city: City; km: number } | null };

export default function CityPicker() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();

  const [cities,     setCities]     = useState<City[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [q,          setQ]          = useState(typeof params.q === "string" ? params.q : "");
  const [currentId,  setCurrentId]  = useState("");          // city saved before opening
  const [selected,   setSelected]   = useState<City | null>(null);
  const [soon,       setSoon]       = useState<Soon | null>(null);
  const [waitlisted, setWaitlisted] = useState(false);
  const [turfs,      setTurfs]      = useState<any[]>([]);
  const [turfsLoading, setTurfsLoading] = useState(false);
  const [coords,     setCoords]     = useState<{ lat: number; lng: number } | null>(null);
  const [detecting,  setDetecting]  = useState(false);
  const [turfCount,  setTurfCount]  = useState<Record<string, number>>({});

  const live = useMemo(() => cities.filter((c) => c.status === "live"), [cities]);

  useEffect(() => {
    (async () => {
      try {
        const [list, saved, savedCoords] = await Promise.all([fetchCities(), getSavedCity(), getSavedCoords()]);
        setCities(list);
        if (saved?.id) setCurrentId(saved.id);
        if (savedCoords) setCoords(savedCoords);
        // Turf count per Live city — one small query each (only Live cities)
        const counts: Record<string, number> = {};
        await Promise.all(
          list.filter((c) => c.status === "live").map(async (c) => {
            try {
              const snap = await getDocs(query(collection(db, "turfs"), where("cityId", "==", c.id)));
              counts[c.id] = snap.docs.filter((d) => isTurf(d.data())).length;
            } catch {}
          }),
        );
        setTurfCount(counts);
      } catch {
        Alert.alert("Couldn't load cities", "Please check your internet and try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Search results ────────────────────────────────────────────────────────
  // No search = Live cities. Search = Live + Coming soon (Hidden never shows).
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return live;
    return cities
      .filter((c) => c.status === "live" || c.status === "coming_soon")
      .filter((c) => [c.name, c.state, ...c.aliases].some((x) => x.toLowerCase().includes(t)))
      .sort((a, b) => (a.status === "live" ? 0 : 1) - (b.status === "live" ? 0 : 1));
  }, [cities, live, q]);
  const exactHit = results.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());

  // All-India suggestions (like other apps): any Indian city/town matching the
  // text, minus the ones that already are PlayOn cities (shown above them).
  const indiaHits = useMemo(() => {
    const t = q.trim();
    if (t.length < 2) return [];
    const known = new Set(
      cities.flatMap((c) => [c.name, c.id, ...c.aliases]).map((x) => x.trim().toLowerCase()),
    );
    return searchIndiaCities(t, 12)
      .filter((c) => !known.has(c.name.toLowerCase()))
      .slice(0, 8);
  }, [q, cities]);

  // ── Pick a city ───────────────────────────────────────────────────────────
  const openLive = async (c: City) => {
    setSelected(c);
    setSoon(null);
    setQ("");
    setCurrentId(c.id);
    markCityAsked();
    saveCityChoice(c);
    setTurfsLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "turfs"), where("cityId", "==", c.id)));
      setTurfs(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isTurf));
    } catch {
      setTurfs([]);
    } finally {
      setTurfsLoading(false);
    }
  };

  const openSoon = (name: string, lat: number | null, lng: number | null) => {
    setSelected(null);
    setQ("");
    setWaitlisted(false);
    markCityAsked();
    setSoon({ name, lat, lng, nearest: lat != null && lng != null ? nearestCity(lat, lng, live, false) : null });
  };

  const pick = (c: City) => (c.status === "live" ? openLive(c) : openSoon(c.name, c.lat, c.lng));

  // ── GPS ───────────────────────────────────────────────────────────────────
  const useMyLocation = async () => {
    if (detecting) return;
    setDetecting(true);
    try {
      if (!(await Location.hasServicesEnabledAsync())) {
        Alert.alert("Location is off", "Turn on location (GPS) on your phone to find turfs near you.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location permission needed", "Allow location access so PlayOn can show turfs near you.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = pos.coords;

      let city = "", area = "";
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (geo.length > 0) {
          city = geo[0].city || geo[0].subregion || geo[0].region || "";
          area = geo[0].district || geo[0].street || geo[0].name || "";
        }
      } catch {}

      setCoords({ lat: latitude, lng: longitude });
      saveCoords(latitude, longitude);
      const uid = auth.currentUser?.uid;
      if (uid) {
        const full = [area, city].filter(Boolean).join(", ") || city || "Current location";
        setDoc(doc(db, "users", uid), { location: full, city, area, latitude, longitude }, { merge: true }).catch(() => {});
      }

      const r = resolveCity(latitude, longitude, city, cities);
      if (r.live) await openLive(r.live);
      else {
        // Player really is here → Home shows "PlayOn is coming to <city>" too
        if (city) saveNotLiveCity(city);
        openSoon(city || "your city", latitude, longitude);
      }
    } catch {
      Alert.alert("Couldn't get your location", "Please try again in a moment.");
    } finally {
      setDetecting(false);
    }
  };

  const notifyMe = async () => {
    if (!soon) return;
    const ok = await joinCityWaitlist(soon.name, soon.lat, soon.lng);
    if (ok) setWaitlisted(true);
    else Alert.alert("Couldn't save", "Please check your internet and try again.");
  };

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  // Selected city's turfs, nearest first when we know where the player is
  const sortedTurfs = useMemo(() => {
    const withKm = turfs.map((t) => ({
      ...t,
      km: coords && typeof t.latitude === "number" && typeof t.longitude === "number"
        ? haversineKm(coords.lat, coords.lng, t.latitude, t.longitude) : null,
    }));
    return withKm.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
  }, [turfs, coords]);

  const searching = !!q.trim();
  const showList = searching || (!selected && !soon);

  return (
    <View style={[s.root, { paddingTop: insets.top + 8 }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* ── Top: back + title + search ── */}
      <View style={s.top}>
        <View style={s.titleRow}>
          <TouchableOpacity style={s.backBtn} onPress={done} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={20} color={BRAND} />
          </TouchableOpacity>
          <Text style={s.title}>Choose your city</Text>
        </View>
        <View style={[s.search, searching && { borderColor: GREEN, borderWidth: 1.5 }]}>
          <Ionicons name="search-outline" size={18} color="#6B7280" />
          <TextInput
            style={s.searchInput}
            placeholder={selected || soon ? "Search another city" : "Search your city"}
            placeholderTextColor="#6B7280"
            value={q}
            onChangeText={setQ}
            autoCorrect={false}
            accessibilityLabel="Search city"
          />
          {searching && (
            <TouchableOpacity onPress={() => setQ("")} style={s.clearBtn} accessibilityLabel="Clear search">
              <Ionicons name="close" size={12} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: selected && !searching ? 110 : 30 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── GPS row (list mode) ── */}
        {showList && (
          <TouchableOpacity style={s.gpsRow} onPress={useMyLocation} disabled={detecting} activeOpacity={0.85}>
            <View style={s.gpsIcon}>
              {detecting ? <ActivityIndicator color="#fff" /> : <Ionicons name="locate" size={20} color="#fff" />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.gpsTitle}>{detecting ? "Finding your location…" : "Use my current location"}</Text>
              <Text style={s.gpsSub}>Exact distance to every turf</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#065F46" />
          </TouchableOpacity>
        )}

        {/* ── City list / search results ── */}
        {showList && (
          <>
            <Text style={s.label}>{searching ? `RESULTS FOR "${q.trim().toUpperCase()}"` : "PLAYON IS LIVE IN"}</Text>
            {loading && <ActivityIndicator color={GREEN} style={{ marginTop: 20 }} />}
            {!loading && results.map((c) => {
              const isSoon = c.status !== "live";
              const on = c.id === currentId && !isSoon;
              const n = turfCount[c.id] || 0;
              return (
                <TouchableOpacity key={c.id} style={s.cityRow} onPress={() => pick(c)} activeOpacity={0.8}
                  accessibilityLabel={`${c.name}${isSoon ? ", coming soon" : ""}${on ? ", current city" : ""}`}>
                  <View style={[s.badge, on && { backgroundColor: BRAND }, isSoon && { backgroundColor: "#FEF3C7" }]}>
                    <Text style={[s.badgeTxt, on && { color: "#fff" }, isSoon && { color: "#92400E" }]}>{c.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cityName}>{c.name}</Text>
                    <Text style={[s.cityMeta, isSoon && { color: "#92400E" }]}>
                      {c.state}{isSoon ? " · Coming soon" : n > 0 ? ` · ${n} turf${n === 1 ? "" : "s"}` : ""}
                    </Text>
                  </View>
                  {on
                    ? <Ionicons name="checkmark" size={22} color={GREEN} />
                    : <Ionicons name="chevron-forward" size={18} color={isSoon ? "#92400E" : BRAND} />}
                </TouchableOpacity>
              );
            })}
            {!loading && indiaHits.map((c) => (
              <TouchableOpacity
                key={`${c.name}|${c.state}`}
                style={s.cityRow}
                onPress={() => openSoon(c.name, c.lat, c.lng)}
                activeOpacity={0.8}
                accessibilityLabel={`${c.name}, ${c.state}, PlayOn not live yet`}
              >
                <View style={s.badge}>
                  <Ionicons name="location-outline" size={18} color="#4B5563" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cityName} numberOfLines={1}>{c.name}</Text>
                  <Text style={s.cityMeta} numberOfLines={1}>{c.state} · PlayOn coming soon</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            ))}
            {!loading && searching && !exactHit && indiaHits.length === 0 && (
              <TouchableOpacity style={s.cityRow} onPress={() => openSoon(titleCase(q.trim()), null, null)} activeOpacity={0.8}>
                <View style={[s.badge, { backgroundColor: "#FEF3C7" }]}>
                  <Ionicons name="location-outline" size={18} color="#92400E" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cityName} numberOfLines={1}>I play in "{q.trim()}"</Text>
                  <Text style={[s.cityMeta, { color: "#92400E" }]}>PlayOn isn't here yet — tap to get notified</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#92400E" />
              </TouchableOpacity>
            )}

            {!searching && (
              <TouchableOpacity style={s.footer} activeOpacity={0.9} onPress={() => router.push("/add-a-turf" as any)}>
                <View style={s.footerIcon}><Ionicons name="add" size={22} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.footerTitle}>City not here?</Text>
                  <Text style={s.footerSub}>Add a turf you know — we'll bring PlayOn there</Text>
                </View>
                <Ionicons name="arrow-forward" size={18} color="#22C55E" />
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── Live city selected → its turfs ── */}
        {!searching && selected && (
          <>
            <View style={s.selCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={s.selTick}><Ionicons name="checkmark" size={20} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.selName}>{selected.name}</Text>
                  <Text style={s.selMeta}>
                    {selected.state}{turfsLoading ? "" : ` · ${turfs.length} turf${turfs.length === 1 ? "" : "s"}`}
                  </Text>
                </View>
              </View>
              <TouchableOpacity style={s.selGps} onPress={useMyLocation} disabled={detecting} activeOpacity={0.85}>
                {detecting ? <ActivityIndicator size="small" color="#BBF7D0" /> : <Ionicons name="locate" size={15} color="#BBF7D0" />}
                <Text style={s.selGpsTxt}>
                  {coords ? "Update my location for exact distance" : "Use my current location for exact distance"}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={s.listHead}>
              <Text style={s.listTitle}>Turfs in {selected.name}</Text>
              {coords && turfs.length > 1 && <Text style={s.listSub}>Nearest first</Text>}
            </View>

            {turfsLoading ? (
              <ActivityIndicator color={GREEN} style={{ marginTop: 20 }} />
            ) : sortedTurfs.length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyTitle}>No turfs listed in {selected.name} yet</Text>
                <Text style={s.emptySub}>Know one? Add it and we'll put it on PlayOn.</Text>
                <TouchableOpacity style={s.emptyBtn} onPress={() => router.push("/add-a-turf" as any)}>
                  <Text style={s.emptyBtnTxt}>Add a turf</Text>
                </TouchableOpacity>
              </View>
            ) : sortedTurfs.map((t) => {
              const sports = getSports(t);
              return (
                <TouchableOpacity key={t.id} style={s.turfCard} onPress={() => router.push(`/turf/${t.id}` as any)} activeOpacity={0.9}>
                  <Image source={{ uri: turfImage(t) }} style={s.turfImg} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={s.turfName} numberOfLines={1}>{t.name}</Text>
                    <Text style={s.turfArea} numberOfLines={1}>
                      {t.locality || t.location || selected.name}{t.km != null ? ` · ${fmtKm(t.km)}` : ""}
                    </Text>
                    {sports.length > 0 && (
                      <View style={s.pillRow}>
                        {sports.slice(0, 3).map((sp) => {
                          const c = SPORT_COLOR[sp] || "#6B7280";
                          return (
                            <View key={sp} style={[s.pill, { backgroundColor: c + "1A" }]}>
                              <Text style={[s.pillTxt, { color: c }]}>{sp}</Text>
                            </View>
                          );
                        })}
                      </View>
                    )}
                    <View style={s.turfFoot}>
                      {hasPrice(t.dayPrice || t.price)
                        ? <Text style={s.price}>₹{t.dayPrice || t.price}<Text style={s.priceUnit}>/hr</Text></Text>
                        : <Text style={[s.price, { fontSize: 13 }]}>Price on call</Text>}
                      <View style={s.bookBtn}><Text style={s.bookTxt}>Book</Text></View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* ── Not live → coming soon ── */}
        {!searching && soon && (
          <>
            <View style={s.soonCard}>
              <View style={s.soonPill}>
                <Ionicons name="time-outline" size={13} color="#92400E" />
                <Text style={s.soonPillTxt}>Coming soon</Text>
              </View>
              <Text style={s.soonTitle}>PlayOn is coming to {soon.name}</Text>
              <Text style={s.soonSub}>No turfs here yet. Get a message the day it goes live.</Text>
              {waitlisted ? (
                <View style={[s.primaryBtn, { backgroundColor: "#DCFCE7" }]}>
                  <Ionicons name="checkmark-circle" size={18} color={GREEN} />
                  <Text style={[s.primaryTxt, { color: GREEN }]}>We'll tell you when it's live</Text>
                </View>
              ) : (
                <TouchableOpacity style={s.primaryBtn} onPress={notifyMe} activeOpacity={0.85}>
                  <Ionicons name="notifications-outline" size={18} color="#fff" />
                  <Text style={s.primaryTxt}>Notify me</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.optionRow} onPress={() => router.push("/add-a-turf" as any)} activeOpacity={0.85}>
                <View style={[s.optionIcon, { backgroundColor: BRAND }]}><Ionicons name="add" size={20} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.optionTitle}>Know a turf here?</Text>
                  <Text style={s.optionSub}>Add it and help bring PlayOn</Text>
                </View>
              </TouchableOpacity>
            </View>

            <Text style={s.label}>{soon.nearest ? "NEAREST LIVE CITY" : "PLAYON IS LIVE IN"}</Text>
            {(soon.nearest ? [soon.nearest.city] : live).map((c) => (
              <TouchableOpacity key={c.id} style={[s.cityRow, s.cityRowCard]} onPress={() => openLive(c)} activeOpacity={0.85}>
                <View style={s.badge}><Text style={s.badgeTxt}>{c.name.charAt(0).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cityName}>{c.name}</Text>
                  <Text style={s.cityMeta}>
                    {soon.nearest ? `${Math.round(soon.nearest.km)} km away` : c.state}
                    {turfCount[c.id] ? ` · ${turfCount[c.id]} turfs` : ""}
                  </Text>
                </View>
                <Text style={s.browse}>Browse</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>

      {/* ── Bottom button when a Live city is selected ── */}
      {selected && !searching && (
        <View style={[s.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={s.primaryBtn} onPress={done} activeOpacity={0.9}>
            <Text style={s.primaryTxt}>Show {selected.name} on Home</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// Turfs only — gyms and ball-machine venues have their own sections
function isTurf(t: any) {
  return t?.active !== false && t?.venueType !== "gym" && t?.venueType !== "ball_machine";
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: "#F5F5F5" },
  top:        { backgroundColor: "#F5F5F5", paddingHorizontal: 16, paddingBottom: 10, gap: 12 },
  titleRow:   { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  title:      { fontSize: 20, fontWeight: "900", color: BRAND, letterSpacing: -0.3 },
  search:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 14, paddingHorizontal: 14, height: 48 },
  searchInput:{ flex: 1, fontSize: 15, color: BRAND, paddingVertical: 0 },
  clearBtn:   { width: 22, height: 22, borderRadius: 11, backgroundColor: "#9CA3AF", alignItems: "center", justifyContent: "center" },

  gpsRow:     { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#A7F3D0", marginHorizontal: 16, marginTop: 4 },
  gpsIcon:    { width: 40, height: 40, borderRadius: 12, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  gpsTitle:   { fontSize: 15, fontWeight: "800", color: "#065F46" },
  gpsSub:     { fontSize: 12, color: "#047857", marginTop: 2 },

  label:      { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: "#4B5563", marginTop: 20, marginBottom: 6, marginHorizontal: 16 },
  cityRow:    { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 4, marginHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  cityRowCard:{ backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 12 },
  badge:      { width: 40, height: 40, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  badgeTxt:   { fontSize: 16, fontWeight: "900", color: BRAND },
  cityName:   { fontSize: 16, fontWeight: "800", color: BRAND },
  cityMeta:   { fontSize: 12, color: "#4B5563", marginTop: 2 },
  browse:     { fontSize: 13, fontWeight: "800", color: GREEN },

  footer:     { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: BRAND, marginHorizontal: 16, marginTop: 20 },
  footerIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  footerTitle:{ fontSize: 14, fontWeight: "800", color: "#fff" },
  footerSub:  { fontSize: 12, color: "#CBD5E1", marginTop: 2 },

  selCard:    { marginHorizontal: 16, marginTop: 6, padding: 14, borderRadius: 16, backgroundColor: BRAND, gap: 10 },
  selTick:    { width: 42, height: 42, borderRadius: 12, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  selName:    { fontSize: 18, fontWeight: "900", color: "#fff" },
  selMeta:    { fontSize: 12, color: "#CBD5E1", marginTop: 2 },
  selGps:     { flexDirection: "row", alignItems: "center", gap: 8, padding: 11, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.1)" },
  selGpsTxt:  { flex: 1, fontSize: 13, fontWeight: "700", color: "#BBF7D0" },

  listHead:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 16, marginTop: 18, marginBottom: 8 },
  listTitle:  { fontSize: 16, fontWeight: "800", color: BRAND },
  listSub:    { fontSize: 12, fontWeight: "700", color: "#4B5563" },

  turfCard:   { flexDirection: "row", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 10, marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  turfImg:    { width: 84, height: 84, borderRadius: 10, backgroundColor: "#E5E7EB" },
  turfName:   { fontSize: 15, fontWeight: "800", color: BRAND },
  turfArea:   { fontSize: 12, color: "#4B5563" },
  pillRow:    { flexDirection: "row", gap: 4, flexWrap: "wrap", marginTop: 2 },
  pill:       { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  pillTxt:    { fontSize: 11, fontWeight: "700" },
  turfFoot:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  price:      { fontSize: 14, fontWeight: "900", color: BRAND },
  priceUnit:  { fontSize: 11, fontWeight: "600", color: "#4B5563" },
  bookBtn:    { backgroundColor: GREEN, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9 },
  bookTxt:    { fontSize: 12, fontWeight: "800", color: "#fff" },

  emptyBox:   { marginHorizontal: 16, padding: 20, borderRadius: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: BRAND, textAlign: "center" },
  emptySub:   { fontSize: 13, color: "#4B5563", marginTop: 4, textAlign: "center" },
  emptyBtn:   { marginTop: 12, backgroundColor: BRAND, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  emptyBtnTxt:{ color: "#fff", fontWeight: "800", fontSize: 13 },

  soonCard:   { marginHorizontal: 16, marginTop: 6, padding: 18, borderRadius: 18, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", gap: 12 },
  soonPill:   { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: "#FEF3C7" },
  soonPillTxt:{ fontSize: 12, fontWeight: "800", color: "#92400E" },
  soonTitle:  { fontSize: 22, fontWeight: "900", color: BRAND, letterSpacing: -0.3 },
  soonSub:    { fontSize: 14, color: "#4B5563", lineHeight: 20, marginTop: -4 },
  primaryBtn: { height: 52, borderRadius: 14, backgroundColor: GREEN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
  optionRow:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  optionIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  optionTitle:{ fontSize: 14, fontWeight: "800", color: BRAND },
  optionSub:  { fontSize: 12, color: "#4B5563", marginTop: 2 },

  bottomBar:  { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB", paddingHorizontal: 16, paddingTop: 12 },
});
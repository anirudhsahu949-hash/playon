/**
 * admin/cities.tsx — Manage the cities PlayOn runs in.
 *
 *  ✅ Add / edit a city: name, state, map-pin centre, radius, status, other names
 *  ✅ Status: Live (players see it) · Coming soon (in picker, no turfs yet) · Hidden (setup)
 *  ✅ One default city (shown when we can't tell where a player is)
 *  ✅ Turf count per city
 *  ✅ "Turfs without a city" — auto-tag by map pin / location text, or pick by hand
 *  ✅ First run: one tap to set up Amravati and tag the existing turfs
 *  ✅ Waitlist: players who tapped "Notify me" per city (cityWaitlist) — see where to launch next
 *
 * Firestore: cities/{slug}  ·  turfs.{cityId, cityName}
 */
import {
  View, Text, StyleSheet, StatusBar, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, RefreshControl, Modal, Platform, KeyboardAvoidingView, Switch,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import {
  collection, getDocs, doc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";
import MapPickerModal from "../../components/Mappickermodal";
import {
  City, CityStatus, CITY_STATUS_META, DEFAULT_RADIUS_KM,
  citySlug, toCity, sortCities, guessCity, clearCitiesCache,
} from "../../utils/cities";
import { searchIndiaCities } from "../../utils/indiaCities";

const DARK = "#0A0F1E";
const ACCENT = "#0EA5A4";
const RADIUS_OPTS = [10, 15, 25, 40, 60];
const STATUS_ORDER: CityStatus[] = ["live", "coming_soon", "hidden"];

type TurfLite = {
  id: string; name: string; location: string;
  latitude: number | null; longitude: number | null;
  cityId: string; active: boolean;
};

type Form = {
  name: string; state: string; lat: string; lng: string;
  radiusKm: number; status: CityStatus; aliases: string; order: string; isDefault: boolean;
};
const EMPTY_FORM = (): Form => ({
  name: "", state: "Maharashtra", lat: "", lng: "",
  radiusKm: DEFAULT_RADIUS_KM, status: "hidden", aliases: "", order: "", isDefault: false,
});

export default function AdminCities() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [cities, setCities] = useState<City[]>([]);
  const [turfs, setTurfs] = useState<TurfLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<City | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM());
  const [showMap, setShowMap] = useState(false);
  const [finding, setFinding] = useState(false);

  const [pickFor, setPickFor] = useState<TurfLite | null>(null); // manual city pick for one turf
  // cityWaitlist grouped by cityKey → { name, count }
  const [waitlist, setWaitlist] = useState<Record<string, { name: string; count: number }>>({});

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [cSnap, tSnap, wSnap] = await Promise.all([
        getDocs(collection(db, "cities")),
        getDocs(collection(db, "turfs")),
        getDocs(collection(db, "cityWaitlist")).catch(() => null),   // never block the screen on this
      ]);
      const w: Record<string, { name: string; count: number }> = {};
      wSnap?.docs.forEach((d) => {
        const x: any = d.data();
        const key = x.cityKey || citySlug(x.cityName || "");
        if (!key) return;
        if (!w[key]) w[key] = { name: x.cityName || key, count: 0 };
        w[key].count += 1;
      });
      setWaitlist(w);
      setCities(sortCities(cSnap.docs.map((d) => toCity(d.id, d.data()))));
      setTurfs(tSnap.docs.map((d) => {
        const t: any = d.data();
        return {
          id: d.id,
          name: t.name || "Unnamed",
          location: t.location || "",
          latitude: typeof t.latitude === "number" ? t.latitude : null,
          longitude: typeof t.longitude === "number" ? t.longitude : null,
          cityId: t.cityId || "",
          active: t.active !== false,
        };
      }));
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not load cities.");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const cityIds = useMemo(() => new Set(cities.map((c) => c.id)), [cities]);
  const turfCount = useMemo(() => {
    const m: Record<string, number> = {};
    turfs.forEach((t) => { if (t.cityId) m[t.cityId] = (m[t.cityId] || 0) + 1; });
    return m;
  }, [turfs]);
  // "untagged" also catches turfs pointing at a city that was deleted
  const untagged = useMemo(() => turfs.filter((t) => !t.cityId || !cityIds.has(t.cityId)), [turfs, cityIds]);
  const suggestions = useMemo(() => {
    const m: Record<string, City | null> = {};
    untagged.forEach((t) => {
      m[t.id] = guessCity({ lat: t.latitude, lng: t.longitude, text: t.location }, cities);
    });
    return m;
  }, [untagged, cities]);
  const autoTaggable = untagged.filter((t) => !!suggestions[t.id]);
  const liveCount = cities.filter((c) => c.status === "live").length;
  // Waitlisted names can be an alias of a city ("Amravati Division") — count them under it
  const waitFor = (c: City) => {
    const keys = new Set([c.id, ...c.aliases.map(citySlug)]);
    return Object.entries(waitlist).reduce((n, [k, v]) => (keys.has(k) ? n + v.count : n), 0);
  };
  const unknownWaits = useMemo(() => {
    const known = new Set(cities.flatMap((c) => [c.id, ...c.aliases.map(citySlug)]));
    return Object.entries(waitlist)
      .filter(([k]) => !known.has(k))
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [waitlist, cities]);

  // ── First run: Amravati ───────────────────────────────────────────────────
  const setupAmravati = () => {
    Alert.alert(
      "Set up Amravati?",
      "This will:\n\n• Create the city Amravati (Maharashtra) as Live and the default city\n• Centre: 20.9374, 77.7796 · radius 25 km\n• Other names: Amravati Division, Badnera\n• Tag every turf near Amravati with this city",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Set up", onPress: async () => {
            setBusy(true);
            try {
              const amravati: Omit<City, "id"> = {
                name: "Amravati", state: "Maharashtra", lat: 20.9374, lng: 77.7796,
                radiusKm: 25, status: "live", aliases: ["Amravati Division", "Badnera"],
                isDefault: true, order: 1,
              };
              await setDoc(doc(db, "cities", "amravati"), { ...amravati, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
              const list = [{ id: "amravati", ...amravati } as City];
              // Tag existing turfs that are near / mention Amravati
              const batch = writeBatch(db);
              let n = 0;
              turfs.forEach((t) => {
                if (t.cityId) return;
                const hit = guessCity({ lat: t.latitude, lng: t.longitude, text: t.location }, list);
                if (hit) { batch.update(doc(db, "turfs", t.id), { cityId: hit.id, cityName: hit.name }); n++; }
              });
              if (n > 0) await batch.commit();
              clearCitiesCache();
              await fetchAll(true);
              Alert.alert("Amravati is set up ✓", `${n} turf${n === 1 ? "" : "s"} tagged with Amravati.`);
            } catch (e: any) {
              Alert.alert("Error", e?.message || "Could not set up Amravati.");
            } finally { setBusy(false); }
          },
        },
      ],
    );
  };

  // ── Add / edit ────────────────────────────────────────────────────────────
  const openAdd = (name = "") => {
    setEditing(null);
    setForm({ ...EMPTY_FORM(), name, order: String(cities.length + 1) });
    setModal(true);
  };

  const openEdit = (c: City) => {
    setEditing(c);
    setForm({
      name: c.name, state: c.state,
      lat: c.lat != null ? String(c.lat) : "", lng: c.lng != null ? String(c.lng) : "",
      radiusKm: c.radiusKm, status: c.status, aliases: c.aliases.join(", "),
      order: c.order != null && c.order !== 999 ? String(c.order) : "", isDefault: !!c.isDefault,
    });
    setModal(true);
  };

  const findCentre = async () => {
    const q = [form.name.trim(), form.state.trim(), "India"].filter(Boolean).join(", ");
    if (!form.name.trim()) return Alert.alert("City name first", "Type the city name, then tap Find.");
    setFinding(true);
    try {
      const res = await Location.geocodeAsync(q);
      if (res.length === 0) return Alert.alert("Not found", "Couldn't find that city. Drop a pin on the map instead.");
      setForm((f) => ({ ...f, lat: res[0].latitude.toFixed(5), lng: res[0].longitude.toFixed(5) }));
    } catch {
      Alert.alert("Error", "Couldn't look up the city. Drop a pin on the map instead.");
    } finally { setFinding(false); }
  };

  const onMapConfirm = (lat: number, lng: number) => {
    setForm((f) => ({ ...f, lat: lat.toFixed(5), lng: lng.toFixed(5) }));
    setShowMap(false);
  };

  const buildPayload = () => {
    const lat = parseFloat(form.lat), lng = parseFloat(form.lng);
    return {
      name: form.name.trim(),
      state: form.state.trim(),
      lat: isNaN(lat) ? null : Number(lat.toFixed(5)),
      lng: isNaN(lng) ? null : Number(lng.toFixed(5)),
      radiusKm: form.radiusKm,
      status: form.status,
      aliases: form.aliases.split(",").map((a) => a.trim()).filter(Boolean),
      order: form.order.trim() ? Number(form.order) : cities.length + 1,
      isDefault: form.isDefault,
    };
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return "City name is required.";
    if (!form.state.trim()) return "State is required.";
    const lat = parseFloat(form.lat), lng = parseFloat(form.lng);
    if (isNaN(lat) || isNaN(lng)) return "Set the city centre — tap Find or drop a pin on the map.";
    if (lat < 6 || lat > 37 || lng < 68 || lng > 98) return "That centre is outside India. Check the pin.";
    if (!editing) {
      const id = citySlug(form.name);
      if (!id) return "City name needs letters or numbers.";
      if (cityIds.has(id)) return `"${form.name.trim()}" already exists.`;
    }
    return null;
  };

  // Save shows a confirm listing what changed (same as other admin saves)
  const confirmSave = () => {
    const err = validate();
    if (err) return Alert.alert("Check this", err);
    const p = buildPayload();
    const lines: string[] = [];
    if (!editing) {
      lines.push(`New city: ${p.name}, ${p.state}`, `Status: ${CITY_STATUS_META[p.status].label}`, `Radius: ${p.radiusKm} km`);
      if (p.aliases.length) lines.push(`Other names: ${p.aliases.join(", ")}`);
      if (p.isDefault) lines.push("Default city: yes");
    } else {
      const e = editing;
      if (p.name !== e.name) lines.push(`Name: ${e.name} → ${p.name}`);
      if (p.state !== e.state) lines.push(`State: ${e.state || "—"} → ${p.state}`);
      if (p.status !== e.status) lines.push(`Status: ${CITY_STATUS_META[e.status].label} → ${CITY_STATUS_META[p.status].label}`);
      if (p.radiusKm !== e.radiusKm) lines.push(`Radius: ${e.radiusKm} km → ${p.radiusKm} km`);
      if (p.lat !== e.lat || p.lng !== e.lng) lines.push(`Centre: moved to ${p.lat}, ${p.lng}`);
      if (p.aliases.join(", ") !== e.aliases.join(", ")) lines.push(`Other names: ${p.aliases.join(", ") || "none"}`);
      if (p.order !== (e.order ?? 999)) lines.push(`Order: ${p.order}`);
      if (p.isDefault !== !!e.isDefault) lines.push(`Default city: ${p.isDefault ? "yes" : "no"}`);
      if (lines.length === 0) return setModal(false);
    }
    Alert.alert(editing ? "Save changes?" : "Add city?", lines.map((l) => `• ${l}`).join("\n"), [
      { text: "Cancel", style: "cancel" },
      { text: "Save", onPress: () => save(p) },
    ]);
  };

  const save = async (p: ReturnType<typeof buildPayload>) => {
    setBusy(true);
    try {
      const id = editing ? editing.id : citySlug(p.name);
      const batch = writeBatch(db);
      batch.set(doc(db, "cities", id), {
        ...p,
        updatedAt: serverTimestamp(),
        ...(editing ? {} : { createdAt: serverTimestamp() }),
      }, { merge: true });
      // Only one default city
      if (p.isDefault) {
        cities.forEach((c) => { if (c.id !== id && c.isDefault) batch.update(doc(db, "cities", c.id), { isDefault: false }); });
      }
      // Renamed → keep turfs' cityName in sync
      if (editing && p.name !== editing.name) {
        turfs.filter((t) => t.cityId === id).forEach((t) => batch.update(doc(db, "turfs", t.id), { cityName: p.name }));
      }
      await batch.commit();
      clearCitiesCache();
      setModal(false);
      await fetchAll(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save the city.");
    } finally { setBusy(false); }
  };

  const setStatus = (c: City, status: CityStatus) => {
    if (c.status === status) return;
    const msg =
      status === "live" ? `Players will see ${c.name} and its turfs.` :
      status === "coming_soon" ? `${c.name} shows as "Coming soon" in the city picker. Its turfs are hidden from players.` :
      `${c.name} is hidden from players completely.`;
    Alert.alert(`Make ${c.name} ${CITY_STATUS_META[status].label}?`, msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Yes", onPress: async () => {
        try {
          await updateDoc(doc(db, "cities", c.id), { status, updatedAt: serverTimestamp() });
          clearCitiesCache();
          setCities((prev) => prev.map((x) => (x.id === c.id ? { ...x, status } : x)));
        } catch (e: any) { Alert.alert("Error", e?.message || "Could not update."); }
      } },
    ]);
  };

  const removeCity = (c: City) => {
    const n = turfCount[c.id] || 0;
    if (n > 0) return Alert.alert("Can't delete", `${c.name} still has ${n} turf${n === 1 ? "" : "s"}. Move them to another city first, or set the city to Hidden.`);
    if (c.isDefault) return Alert.alert("Can't delete", "This is the default city. Make another city the default first.");
    Alert.alert(`Delete ${c.name}?`, "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await deleteDoc(doc(db, "cities", c.id));
          clearCitiesCache();
          setCities((prev) => prev.filter((x) => x.id !== c.id));
        } catch (e: any) { Alert.alert("Error", e?.message || "Could not delete."); }
      } },
    ]);
  };

  // ── Tag turfs ─────────────────────────────────────────────────────────────
  const tagTurf = async (t: TurfLite, c: City) => {
    try {
      await updateDoc(doc(db, "turfs", t.id), { cityId: c.id, cityName: c.name });
      setTurfs((prev) => prev.map((x) => (x.id === t.id ? { ...x, cityId: c.id } : x)));
    } catch (e: any) { Alert.alert("Error", e?.message || "Could not update the turf."); }
  };

  const autoTagAll = () => {
    if (autoTaggable.length === 0) return;
    const preview = autoTaggable.slice(0, 8).map((t) => `• ${t.name} → ${suggestions[t.id]!.name}`).join("\n");
    const more = autoTaggable.length > 8 ? `\n…and ${autoTaggable.length - 8} more` : "";
    Alert.alert(`Tag ${autoTaggable.length} turf${autoTaggable.length === 1 ? "" : "s"}?`, preview + more, [
      { text: "Cancel", style: "cancel" },
      { text: "Tag all", onPress: async () => {
        setBusy(true);
        try {
          // Firestore batches max out at 500 writes
          for (let i = 0; i < autoTaggable.length; i += 400) {
            const batch = writeBatch(db);
            autoTaggable.slice(i, i + 400).forEach((t) => {
              const c = suggestions[t.id]!;
              batch.update(doc(db, "turfs", t.id), { cityId: c.id, cityName: c.name });
            });
            await batch.commit();
          }
          await fetchAll(true);
        } catch (e: any) { Alert.alert("Error", e?.message || "Could not tag turfs."); }
        finally { setBusy(false); }
      } },
    ]);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.loadWrap}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={s.loadText}>Loading cities...</Text>
      </View>
    );
  }

  const parsedLat = parseFloat(form.lat), parsedLng = parseFloat(form.lng);

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={ACCENT} />}
      >
        {/* Hero */}
        <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={s.heroTag}>All India</Text>
          <Text style={s.heroTitle}>Cities</Text>
          <Text style={s.heroSub}>Choose where PlayOn is live. Every turf belongs to one city.</Text>
          <View style={s.heroStats}>
            {[
              { label: "Live", value: liveCount, color: "#34D399" },
              { label: "Coming soon", value: cities.filter((c) => c.status === "coming_soon").length, color: "#FBBF24" },
              { label: "Turfs", value: turfs.length, color: "#60A5FA" },
              { label: "No city", value: untagged.length, color: untagged.length ? "#F87171" : "#9CA3AF" },
            ].map((st) => (
              <View key={st.label} style={s.heroStat}>
                <Text style={[s.heroStatValue, { color: st.color }]}>{st.value}</Text>
                <Text style={s.heroStatLabel}>{st.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* First run */}
        {cities.length === 0 && (
          <View style={s.setupCard}>
            <Text style={{ fontSize: 30 }}>📍</Text>
            <Text style={s.setupTitle}>No cities yet</Text>
            <Text style={s.setupSub}>Start with Amravati. Your existing turfs will be tagged with it automatically.</Text>
            <TouchableOpacity style={[s.primaryBtn, busy && { opacity: 0.6 }]} onPress={setupAmravati} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : (<><Ionicons name="flash-outline" size={17} color="#fff" /><Text style={s.primaryBtnTxt}>Set up Amravati</Text></>)}
            </TouchableOpacity>
          </View>
        )}

        {/* City list */}
        <View style={s.listHead}>
          <Text style={s.sectionLabel}>{cities.length} {cities.length === 1 ? "CITY" : "CITIES"}</Text>
          <TouchableOpacity style={s.addBtn} onPress={() => openAdd()}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={s.addBtnTxt}>Add City</Text>
          </TouchableOpacity>
        </View>

        {cities.map((c) => {
          const meta = CITY_STATUS_META[c.status];
          const n = turfCount[c.id] || 0;
          const waiting = waitFor(c);
          return (
            <View key={c.id} style={s.card}>
              <View style={s.cardTop}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={s.cityName}>{c.name}</Text>
                    {c.isDefault && (
                      <View style={s.defaultPill}><Ionicons name="star" size={10} color="#B45309" /><Text style={s.defaultTxt}>Default</Text></View>
                    )}
                  </View>
                  <Text style={s.cityMeta}>{c.state || "—"} · {c.radiusKm} km radius{c.lat == null ? " · ⚠ no centre" : ""}</Text>
                  {c.aliases.length > 0 && <Text style={s.cityAliases} numberOfLines={1}>Also: {c.aliases.join(", ")}</Text>}
                </View>
                <View style={[s.statusPill, { backgroundColor: meta.bg }]}>
                  <Text style={[s.statusTxt, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>

              <View style={s.countRow}>
                <Ionicons name="football-outline" size={14} color="#374151" />
                <Text style={s.countTxt}>{n} turf{n === 1 ? "" : "s"}</Text>
                {waiting > 0 && (
                  <>
                    <Text style={s.countTxt}>  ·</Text>
                    <Ionicons name="notifications-outline" size={14} color="#B45309" />
                    <Text style={[s.countTxt, { color: "#B45309" }]}>{waiting} waiting</Text>
                  </>
                )}
                {c.status === "live" && n === 0 && <Text style={s.warnTxt}>· Live with no turfs — players see an empty city</Text>}
              </View>

              <View style={s.statusRow}>
                {STATUS_ORDER.map((st) => (
                  <TouchableOpacity key={st} style={[s.statusChip, c.status === st && { backgroundColor: DARK, borderColor: DARK }]} onPress={() => setStatus(c, st)}>
                    <Text style={[s.statusChipTxt, c.status === st && { color: "#fff" }]}>{CITY_STATUS_META[st].label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.cardActions}>
                <TouchableOpacity style={s.editBtn} onPress={() => openEdit(c)}>
                  <Ionicons name="pencil-outline" size={14} color="#fff" />
                  <Text style={s.editBtnTxt}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.deleteBtn} onPress={() => removeCity(c)} accessibilityLabel={`Delete ${c.name}`}>
                  <Ionicons name="trash-outline" size={15} color="#DC2626" />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {/* Turfs without a city */}
        {cities.length > 0 && untagged.length > 0 && (
          <View style={s.untaggedWrap}>
            <View style={s.untaggedHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.untaggedTitle}>Turfs without a city ({untagged.length})</Text>
                <Text style={s.untaggedSub}>Players won't see these in any city until they're tagged.</Text>
              </View>
              {autoTaggable.length > 0 && (
                <TouchableOpacity style={[s.autoBtn, busy && { opacity: 0.6 }]} onPress={autoTagAll} disabled={busy}>
                  <Ionicons name="sparkles-outline" size={14} color="#fff" />
                  <Text style={s.autoBtnTxt}>Auto-tag {autoTaggable.length}</Text>
                </TouchableOpacity>
              )}
            </View>
            {untagged.map((t) => {
              const sug = suggestions[t.id];
              return (
                <View key={t.id} style={s.turfRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.turfName} numberOfLines={1}>{t.name}</Text>
                    <Text style={s.turfLoc} numberOfLines={1}>
                      {t.location || "No location text"}{t.latitude == null ? " · no map pin" : ""}
                    </Text>
                  </View>
                  {sug ? (
                    <TouchableOpacity style={s.sugBtn} onPress={() => tagTurf(t, sug)}>
                      <Text style={s.sugBtnTxt}>{sug.name}</Text>
                      <Ionicons name="checkmark" size={13} color="#15803D" />
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={s.pickBtn} onPress={() => setPickFor(t)} accessibilityLabel={`Pick a city for ${t.name}`}>
                    <Ionicons name="chevron-down" size={15} color="#374151" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* Players waiting in cities you haven't added yet */}
        {unknownWaits.length > 0 && (
          <View style={s.waitWrap}>
            <Text style={s.waitTitle}>Players asking for new cities</Text>
            <Text style={s.waitSub}>They tapped "Notify me". Add a city to start collecting turfs there.</Text>
            {unknownWaits.map((w) => (
              <View key={w.key} style={s.waitRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.turfName}>{w.name}</Text>
                  <Text style={s.turfLoc}>{w.count} player{w.count === 1 ? "" : "s"} waiting</Text>
                </View>
                <TouchableOpacity style={s.waitAddBtn} onPress={() => openAdd(w.name)}>
                  <Ionicons name="add" size={14} color="#fff" />
                  <Text style={s.waitAddTxt}>Add city</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={s.helpBox}>
          <Ionicons name="information-circle-outline" size={16} color={ACCENT} />
          <Text style={s.helpTxt}>
            New turfs get their city from the Add Turf form. Set a city to "Coming soon" while you collect turfs there, then switch it to Live.
          </Text>
        </View>
      </ScrollView>

      {/* ── Add / Edit modal ── */}
      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.backdrop}>
            <View style={s.sheet}>
              <View style={s.handle} />
              <View style={s.sheetHead}>
                <Text style={s.sheetTitle}>{editing ? `Edit ${editing.name}` : "Add City"}</Text>
                <TouchableOpacity style={s.closeBtn} onPress={() => setModal(false)} accessibilityLabel="Close">
                  <Ionicons name="close" size={20} color="#374151" />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={s.label}>City name *</Text>
                <TextInput style={s.input} placeholder="e.g. Nagpur" placeholderTextColor="#9CA3AF"
                  value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} autoCapitalize="words" />
                {/* All-India suggestions: tap one → name, state and centre filled in */}
                {!editing && form.name.trim().length >= 2 && !form.lat && (
                  <View style={s.sugList}>
                    {searchIndiaCities(form.name, 5).map((c) => (
                      <TouchableOpacity
                        key={`${c.name}|${c.state}`}
                        style={s.sugRow}
                        onPress={() => setForm((f) => ({ ...f, name: c.name, state: c.state, lat: String(c.lat), lng: String(c.lng) }))}
                      >
                        <Ionicons name="location-outline" size={15} color={ACCENT} />
                        <Text style={s.sugRowTxt} numberOfLines={1}>{c.name}</Text>
                        <Text style={s.sugRowState} numberOfLines={1}>{c.state}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {!editing && form.name.trim() ? <Text style={s.hint}>City ID: {citySlug(form.name)} (can't change later)</Text> : null}

                <Text style={s.label}>State *</Text>
                <TextInput style={s.input} placeholder="e.g. Maharashtra" placeholderTextColor="#9CA3AF"
                  value={form.state} onChangeText={(v) => setForm((f) => ({ ...f, state: v }))} autoCapitalize="words" />

                <Text style={s.label}>City centre *</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity style={[s.outlineBtn, { flex: 1 }, finding && { opacity: 0.6 }]} onPress={findCentre} disabled={finding}>
                    {finding ? <ActivityIndicator size="small" color={ACCENT} /> : <Ionicons name="search-outline" size={15} color={ACCENT} />}
                    <Text style={s.outlineBtnTxt}>Find from name</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.solidBtn, { flex: 1 }]} onPress={() => setShowMap(true)}>
                    <Ionicons name="map-outline" size={15} color="#fff" />
                    <Text style={s.solidBtnTxt}>Drop pin</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <TextInput style={[s.input, { flex: 1 }]} placeholder="Latitude" placeholderTextColor="#9CA3AF" keyboardType="decimal-pad"
                    value={form.lat} onChangeText={(v) => setForm((f) => ({ ...f, lat: v }))} />
                  <TextInput style={[s.input, { flex: 1 }]} placeholder="Longitude" placeholderTextColor="#9CA3AF" keyboardType="decimal-pad"
                    value={form.lng} onChangeText={(v) => setForm((f) => ({ ...f, lng: v }))} />
                </View>

                <Text style={s.label}>Radius</Text>
                <View style={s.chipRow}>
                  {RADIUS_OPTS.map((r) => (
                    <TouchableOpacity key={r} style={[s.chip, form.radiusKm === r && s.chipOn]} onPress={() => setForm((f) => ({ ...f, radiusKm: r }))}>
                      <Text style={[s.chipTxt, form.radiusKm === r && s.chipTxtOn]}>{r} km</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.hint}>Turfs and players within this distance of the centre count as this city. 25 km suits most cities; use 40–60 km for big metros.</Text>

                <Text style={s.label}>Status</Text>
                <View style={s.chipRow}>
                  {STATUS_ORDER.map((st) => (
                    <TouchableOpacity key={st} style={[s.chip, form.status === st && s.chipOn]} onPress={() => setForm((f) => ({ ...f, status: st }))}>
                      <Text style={[s.chipTxt, form.status === st && s.chipTxtOn]}>{CITY_STATUS_META[st].label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={s.label}>Other names (optional)</Text>
                <TextInput style={s.input} placeholder="e.g. Nagpur City, Kamptee" placeholderTextColor="#9CA3AF"
                  value={form.aliases} onChangeText={(v) => setForm((f) => ({ ...f, aliases: v }))} />
                <Text style={s.hint}>Comma separated. Helps match turfs and GPS names to this city.</Text>

                <Text style={s.label}>Order in city list</Text>
                <TextInput style={s.input} placeholder="1 = first" placeholderTextColor="#9CA3AF" keyboardType="number-pad"
                  value={form.order} onChangeText={(v) => setForm((f) => ({ ...f, order: v.replace(/[^0-9]/g, "") }))} />

                <View style={s.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.toggleLabel}>Default city</Text>
                    <Text style={s.toggleSub}>Shown when we can't tell where a player is.</Text>
                  </View>
                  <Switch value={form.isDefault} onValueChange={(v) => setForm((f) => ({ ...f, isDefault: v }))}
                    trackColor={{ false: "#E5E7EB", true: ACCENT }} thumbColor="#fff" />
                </View>

                <TouchableOpacity style={[s.primaryBtn, { marginTop: 20 }, busy && { opacity: 0.6 }]} onPress={confirmSave} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : (<><Ionicons name="checkmark-circle-outline" size={18} color="#fff" /><Text style={s.primaryBtnTxt}>{editing ? "Save Changes" : "Add City"}</Text></>)}
                </TouchableOpacity>
                <View style={{ height: 28 }} />
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Pick a city for one turf ── */}
      <Modal visible={!!pickFor} animationType="fade" transparent onRequestClose={() => setPickFor(null)}>
        <TouchableOpacity style={s.backdropCenter} activeOpacity={1} onPress={() => setPickFor(null)}>
          <View style={s.pickSheet}>
            <Text style={s.sheetTitle}>City for {pickFor?.name}</Text>
            <ScrollView style={{ maxHeight: 360, marginTop: 10 }}>
              {cities.map((c) => (
                <TouchableOpacity key={c.id} style={s.pickRow} onPress={async () => { const t = pickFor!; setPickFor(null); await tagTurf(t, c); }}>
                  <Text style={s.pickRowTxt}>{c.name}</Text>
                  <Text style={s.pickRowMeta}>{c.state} · {CITY_STATUS_META[c.status].label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={[s.outlineBtn, { marginTop: 10 }]} onPress={() => { setPickFor(null); openAdd(); }}>
              <Ionicons name="add" size={15} color={ACCENT} />
              <Text style={s.outlineBtnTxt}>City not here? Add it</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <MapPickerModal
        visible={showMap}
        initialLocation={[form.name, form.state].filter(Boolean).join(", ") || "India"}
        initialLat={!isNaN(parsedLat) ? parsedLat : undefined}
        initialLng={!isNaN(parsedLng) ? parsedLng : undefined}
        onConfirm={(lat, lng) => onMapConfirm(lat, lng)}
        onClose={() => setShowMap(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F4F8" },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText: { marginTop: 12, color: "#9CA3AF", fontSize: 15, fontWeight: "600" },

  hero: { backgroundColor: DARK, paddingHorizontal: 20, paddingBottom: 22 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center", marginBottom: 12 },
  heroTag: { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle: { color: "#fff", fontSize: 28, fontWeight: "900", marginTop: 4 },
  heroSub: { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },
  heroStats: { flexDirection: "row", gap: 8, marginTop: 16 },
  heroStat: { flex: 1, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  heroStatValue: { fontSize: 20, fontWeight: "900" },
  heroStatLabel: { color: "#9CA3AF", fontSize: 10, fontWeight: "700", marginTop: 2 },

  setupCard: { margin: 16, backgroundColor: "#fff", borderRadius: 18, padding: 20, alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  setupTitle: { fontSize: 18, fontWeight: "900", color: "#111827", marginTop: 8 },
  setupSub: { fontSize: 13, color: "#6B7280", textAlign: "center", marginTop: 6, lineHeight: 19, marginBottom: 14 },

  listHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  sectionLabel: { fontSize: 12, fontWeight: "800", color: "#6B7280", letterSpacing: 1 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: DARK, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  addBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "800" },

  card: { backgroundColor: "#fff", marginHorizontal: 16, marginBottom: 12, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cityName: { fontSize: 18, fontWeight: "900", color: "#111827" },
  cityMeta: { fontSize: 12, color: "#6B7280", marginTop: 3, fontWeight: "600" },
  cityAliases: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  defaultPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEF3C7", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99 },
  defaultTxt: { fontSize: 10, fontWeight: "800", color: "#B45309" },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  statusTxt: { fontSize: 11, fontWeight: "800" },
  countRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, flexWrap: "wrap" },
  countTxt: { fontSize: 13, fontWeight: "800", color: "#374151" },
  warnTxt: { fontSize: 11, fontWeight: "700", color: "#B45309" },
  statusRow: { flexDirection: "row", gap: 6, marginTop: 12 },
  statusChip: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  statusChipTxt: { fontSize: 12, fontWeight: "700", color: "#6B7280" },
  cardActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  editBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: DARK, paddingVertical: 10, borderRadius: 12 },
  editBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "800" },
  deleteBtn: { width: 42, borderRadius: 12, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", alignItems: "center", justifyContent: "center" },

  untaggedWrap: { marginHorizontal: 16, marginTop: 8, backgroundColor: "#FFF7ED", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#FED7AA" },
  untaggedHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  untaggedTitle: { fontSize: 15, fontWeight: "900", color: "#9A3412" },
  untaggedSub: { fontSize: 12, color: "#C2410C", marginTop: 2 },
  autoBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#EA580C", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  autoBtnTxt: { color: "#fff", fontSize: 12, fontWeight: "800" },
  turfRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, padding: 10, marginTop: 6, borderWidth: 1, borderColor: "#FFEDD5" },
  turfName: { fontSize: 14, fontWeight: "800", color: "#111827" },
  turfLoc: { fontSize: 11, color: "#6B7280", marginTop: 2 },
  sugBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#DCFCE7", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9 },
  sugBtnTxt: { fontSize: 12, fontWeight: "800", color: "#15803D" },
  pickBtn: { width: 34, height: 34, borderRadius: 9, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },

  waitWrap: { marginHorizontal: 16, marginTop: 12, backgroundColor: "#EFF6FF", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#BFDBFE" },
  waitTitle: { fontSize: 15, fontWeight: "900", color: "#1E3A8A" },
  waitSub: { fontSize: 12, color: "#1D4ED8", marginTop: 2, marginBottom: 4 },
  waitRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, padding: 10, marginTop: 6, borderWidth: 1, borderColor: "#DBEAFE" },
  waitAddBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#1D4ED8", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9 },
  waitAddTxt: { color: "#fff", fontSize: 12, fontWeight: "800" },

  sugList: { marginTop: 6, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  sugRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#F3F4F6", backgroundColor: "#fff" },
  sugRowTxt: { fontSize: 14, fontWeight: "800", color: "#111827", flexShrink: 1 },
  sugRowState: { fontSize: 12, color: "#6B7280", marginLeft: "auto" },

  helpBox: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginTop: 16, backgroundColor: "#F0FDFA", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#99F6E4" },
  helpTxt: { flex: 1, fontSize: 12, color: "#0F766E", lineHeight: 18, fontWeight: "600" },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  backdropCenter: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "ios" ? 30 : 16, maxHeight: "94%" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 14 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  sheetTitle: { fontSize: 19, fontWeight: "900", color: "#111827" },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  label: { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827" },
  hint: { fontSize: 11, color: "#9CA3AF", marginTop: 5, fontWeight: "500", lineHeight: 16 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  chipOn: { backgroundColor: DARK, borderColor: DARK },
  chipTxt: { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  chipTxtOn: { color: "#fff" },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderColor: ACCENT, paddingVertical: 11, borderRadius: 12 },
  outlineBtnTxt: { color: ACCENT, fontWeight: "800", fontSize: 13 },
  solidBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: ACCENT, paddingVertical: 11, borderRadius: 12 },
  solidBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  toggleLabel: { fontSize: 15, fontWeight: "800", color: "#111827" },
  toggleSub: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, paddingVertical: 15, borderRadius: 16, alignSelf: "stretch" },
  primaryBtnTxt: { color: "#fff", fontWeight: "900", fontSize: 15 },

  pickSheet: { backgroundColor: "#fff", borderRadius: 20, padding: 18 },
  pickRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  pickRowTxt: { fontSize: 15, fontWeight: "800", color: "#111827" },
  pickRowMeta: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
});
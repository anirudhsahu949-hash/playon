/**
 * MapPickerModal.tsx
 * ─────────────────────────────────────────────────────────────
 * Drop-pin location picker — zero new packages required.
 * Uses expo-location (already installed) for:
 *   1. Getting current GPS → centers map there
 *   2. Reverse-geocoding the dropped pin → human address
 *
 * The interactive map is a self-contained HTML page injected
 * into a React Native Modal via a <WebView>.
 * 
 * ⚠️  REQUIRES: npm install react-native-webview
 *     Then add to app.json plugins: "react-native-webview"
 *     (one-time setup, takes ~2 minutes)
 *
 * Usage:
 *   <MapPickerModal
 *     visible={showMap}
 *     initialLocation="Amravati, Maharashtra"
 *     onConfirm={(lat, lng, address) => { ... }}
 *     onClose={() => setShowMap(false)}
 *   />
 */

import React, { useRef, useState, useEffect } from "react";
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Platform, SafeAreaView,
} from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";

const ACCENT = "#0EA5A4";
const DARK   = "#0A0F1E";

type Props = {
  visible:         boolean;
  initialLocation?: string;   // text hint to center on, e.g. "Amravati"
  initialLat?:     number;    // if you already have coords, center there
  initialLng?:     number;
  onConfirm:       (lat: number, lng: number, address: string) => void;
  onClose:         () => void;
};

// ── Build the HTML page injected into WebView ─────────────────────────────────
function buildMapHTML(centerLat: number, centerLng: number): string {
  return `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body,#map { width:100%; height:100%; }
  #hint {
    position:absolute; bottom:16px; left:50%; transform:translateX(-50%);
    background:rgba(10,15,30,0.88); color:#fff;
    font-family:-apple-system,sans-serif; font-size:13px; font-weight:600;
    padding:10px 20px; border-radius:24px;
    white-space:nowrap; z-index:1000; pointer-events:none;
  }
  #confirm {
    position:absolute; bottom:60px; right:16px;
    background:#0EA5A4; color:#fff;
    font-family:-apple-system,sans-serif; font-size:14px; font-weight:700;
    padding:13px 22px; border-radius:14px;
    border:none; cursor:pointer; z-index:1000;
    box-shadow:0 4px 16px rgba(14,165,164,0.4);
  }
</style>
</head>
<body>
<div id="map"></div>
<div id="hint">Tap anywhere to drop a pin</div>
<button id="confirm" onclick="confirmPin()">Confirm Location</button>

<script>
  var map = L.map('map', { zoomControl: true }).setView([${centerLat}, ${centerLng}], 15);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);

  var pinIcon = L.divIcon({
    html: '<div style="width:32px;height:32px;margin-left:-16px;margin-top:-32px;">' +
          '<svg viewBox="0 0 32 44" xmlns="http://www.w3.org/2000/svg">' +
          '<ellipse cx="16" cy="42" rx="6" ry="2" fill="rgba(0,0,0,0.2)"/>' +
          '<path d="M16 0C9.4 0 4 5.4 4 12c0 9 12 28 12 28S28 21 28 12C28 5.4 22.6 0 16 0z" fill="#0EA5A4"/>' +
          '<circle cx="16" cy="12" r="5" fill="white"/>' +
          '</svg></div>',
    className: '',
    iconSize: [32, 44],
  });

  var marker = null;
  var selectedLat = ${centerLat};
  var selectedLng = ${centerLng};

  // Place initial marker
  marker = L.marker([${centerLat}, ${centerLng}], { icon: pinIcon, draggable: true }).addTo(map);
  marker.on('dragend', function(e) {
    selectedLat = e.target.getLatLng().lat;
    selectedLng = e.target.getLatLng().lng;
    updateHint(selectedLat, selectedLng);
  });
  updateHint(${centerLat}, ${centerLng});

  map.on('click', function(e) {
    selectedLat = e.latlng.lat;
    selectedLng = e.latlng.lng;
    if (marker) marker.setLatLng(e.latlng);
    else marker = L.marker(e.latlng, { icon: pinIcon, draggable: true }).addTo(map);
    marker.on('dragend', function(ev) {
      selectedLat = ev.target.getLatLng().lat;
      selectedLng = ev.target.getLatLng().lng;
      updateHint(selectedLat, selectedLng);
    });
    updateHint(selectedLat, selectedLng);
  });

  function updateHint(lat, lng) {
    document.getElementById('hint').textContent =
      lat.toFixed(5) + ', ' + lng.toFixed(5) + '  •  Drag pin to adjust';
  }

  function confirmPin() {
    window.ReactNativeWebView.postMessage(
      JSON.stringify({ lat: selectedLat, lng: selectedLng })
    );
  }
</script>
</body>
</html>
`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MapPickerModal({
  visible, initialLocation, initialLat, initialLng, onConfirm, onClose,
}: Props) {
  const webRef = useRef<WebView>(null);
  const [centerLat, setCenterLat] = useState(initialLat ?? 20.9374);
  const [centerLng, setCenterLng] = useState(initialLng ?? 77.7796);
  const [locating,  setLocating]  = useState(false);
  const [mapReady,  setMapReady]  = useState(false);
  const [address,   setAddress]   = useState("");

  // When modal opens, center on saved coords or geocode the text location
  useEffect(() => {
    if (!visible) { setMapReady(false); return; }

    if (initialLat != null && initialLng != null) {
      setCenterLat(initialLat);
      setCenterLng(initialLng);
      return;
    }

    if (initialLocation?.trim()) {
      geocodeInitial(initialLocation.trim());
    } else {
      getCurrentGPS();
    }
  }, [visible]);

  const geocodeInitial = async (text: string) => {
    setLocating(true);
    try {
      const results = await Location.geocodeAsync(text);
      if (results.length > 0) {
        setCenterLat(results[0].latitude);
        setCenterLng(results[0].longitude);
      }
    } catch { /* fall through to default */ }
    finally { setLocating(false); }
  };

  const getCurrentGPS = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      setCenterLat(loc.coords.latitude);
      setCenterLng(loc.coords.longitude);
    } catch { /* fall through */ }
    finally { setLocating(false); }
  };

  // Message from WebView when user taps "Confirm Location"
  const onMessage = async (event: any) => {
    try {
      const { lat, lng } = JSON.parse(event.nativeEvent.data);

      // Reverse-geocode to get a human address
      let humanAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (geo.length > 0) {
          const p = geo[0];
          const parts = [
            p.street || p.name,
            p.district || p.subregion,
            p.city || p.subregion,
            p.region,
          ].filter(Boolean);
          if (parts.length > 0) humanAddress = parts.join(", ");
        }
      } catch { /* use coords as fallback */ }

      setAddress(humanAddress);
      onConfirm(lat, lng, humanAddress);
    } catch {
      Alert.alert("Error", "Could not read pin location.");
    }
  };

  const html = buildMapHTML(centerLat, centerLng);

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <SafeAreaView style={st.safe}>

        {/* ── Header ── */}
        <View style={st.header}>
          <TouchableOpacity style={st.closeBtn} onPress={onClose} activeOpacity={0.8}>
            <Ionicons name="close" size={20} color="#374151" />
          </TouchableOpacity>
          <View style={st.headerCenter}>
            <Text style={st.headerTitle}>Pick Location</Text>
            <Text style={st.headerSub}>Tap map or drag pin to set turf location</Text>
          </View>
          <TouchableOpacity style={st.gpsBtn} onPress={getCurrentGPS} activeOpacity={0.8} disabled={locating}>
            {locating
              ? <ActivityIndicator size="small" color={ACCENT} />
              : <Ionicons name="locate-outline" size={20} color={ACCENT} />
            }
          </TouchableOpacity>
        </View>

        {/* ── Map ── */}
        {locating && !mapReady ? (
          <View style={st.loadingBox}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={st.loadingText}>Finding location…</Text>
          </View>
        ) : (
          <WebView
            ref={webRef}
            style={st.map}
            source={{ html }}
            onMessage={onMessage}
            onLoad={() => setMapReady(true)}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={st.loadingBox}>
                <ActivityIndicator size="large" color={ACCENT} />
                <Text style={st.loadingText}>Loading map…</Text>
              </View>
            )}
          />
        )}

        {/* ── Footer hint ── */}
        <View style={st.footer}>
          <Ionicons name="information-circle-outline" size={15} color="#6B7280" />
          <Text style={st.footerText}>
            Tap the map to place a pin · Drag to fine-tune · Tap <Text style={{ fontWeight: "800", color: ACCENT }}>Confirm Location</Text> on the map
          </Text>
        </View>

      </SafeAreaView>
    </Modal>
  );
}

const st = StyleSheet.create({
  safe:        { marginTop:20, marginBottom:35, flex: 1, backgroundColor: "#fff" },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6", gap: 10 },
  closeBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center" },
  headerCenter:{ flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: "800", color: DARK },
  headerSub:   { fontSize: 12, color: "#9CA3AF", marginTop: 1 },
  gpsBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F0FDFA", borderWidth: 1, borderColor: "#99F6E4", justifyContent: "center", alignItems: "center" },
  map:         { flex: 1 },
  loadingBox:  { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14, color: "#6B7280", fontWeight: "600" },
  footer:      { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 14, backgroundColor: "#F9FAFB", borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  footerText:  { flex: 1, fontSize: 12, color: "#6B7280", lineHeight: 18 },
});
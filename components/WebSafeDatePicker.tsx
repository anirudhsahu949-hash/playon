/**
 * components/WebSafeDatePicker.tsx
 *
 * Drop-in replacement for @react-native-community/datetimepicker (date mode).
 *   • Android / iOS → the normal DateTimePicker (unchanged)
 *   • Web           → a small popup with the browser's own date box
 *     (the community picker renders NOTHING on web, so "Pick date" did nothing)
 *
 * Same props and same onChange(event, date) shape, so in a screen you only
 * change the import line:
 *   import DateTimePicker from "../../components/WebSafeDatePicker";
 */
import React, { useEffect, useRef, useState } from "react";
import { Platform, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import NativeDateTimePicker from "@react-native-community/datetimepicker";

type PickerEvent = { type: "set" | "dismissed"; nativeEvent?: any };
type Props = {
  value: Date;
  mode?: "date" | "time" | "datetime";
  minimumDate?: Date;
  maximumDate?: Date;
  onChange: (event: PickerEvent, date?: Date) => void;
  [key: string]: any;
};

const pad = (n: number) => String(n).padStart(2, "0");
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function WebDatePicker({ value, minimumDate, maximumDate, onChange }: Props) {
  const [val, setVal] = useState(toInput(value));
  const inputRef = useRef<any>(null);

  useEffect(() => {
    // Open the browser calendar straight away where supported
    try { inputRef.current?.focus(); inputRef.current?.showPicker?.(); } catch {}
  }, []);

  const done = () => {
    if (!val) return onChange({ type: "dismissed" });
    const [y, m, d] = val.split("-").map(Number);
    onChange({ type: "set" }, new Date(y, m - 1, d, 12, 0, 0));
  };

  return (
    <View style={st.backdrop}>
      <View style={st.sheet}>
        <Text style={st.title}>Pick a date</Text>
        {React.createElement("input", {
          ref: inputRef,
          type: "date",
          value: val,
          min: minimumDate ? toInput(minimumDate) : undefined,
          max: maximumDate ? toInput(maximumDate) : undefined,
          onChange: (e: any) => setVal(e.target.value),
          style: {
            fontSize: 16, padding: 10, borderRadius: 10, border: "1px solid #E5E7EB",
            width: "100%", boxSizing: "border-box", marginTop: 12,
          },
        })}
        <View style={st.row}>
          <TouchableOpacity style={[st.btn, st.cancel]} onPress={() => onChange({ type: "dismissed" })}>
            <Text style={st.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.btn, st.ok]} onPress={done}>
            <Text style={st.okTxt}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function WebSafeDatePicker(props: Props) {
  if (Platform.OS === "web") return <WebDatePicker {...props} />;
  return <NativeDateTimePicker {...(props as any)} />;
}

const st = StyleSheet.create({
  backdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", zIndex: 9999,
  },
  sheet: { backgroundColor: "#fff", borderRadius: 18, padding: 20, width: 320, maxWidth: "90%" },
  title: { fontSize: 16, fontWeight: "800", color: "#111827" },
  row: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  cancel: { backgroundColor: "#F3F4F6" },
  cancelTxt: { color: "#374151", fontWeight: "700" },
  ok: { backgroundColor: "#0A0F1E" },
  okTxt: { color: "#fff", fontWeight: "800" },
});

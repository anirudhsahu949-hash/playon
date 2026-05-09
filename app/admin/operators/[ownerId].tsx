import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  StatusBar,
  Alert,
} from "react-native";
import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { db } from "../../../firebaseConfig";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";

export default function OperatorScreen() {
  const { ownerId } = useLocalSearchParams();

  const [operators, setOperators] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    fetchOperators();
  }, []);

  const fetchOperators = async () => {
    const q = query(
      collection(db, "users"),
      where("role", "==", "turf-operator"),
      where("ownerId", "==", ownerId)
    );

    const snap = await getDocs(q);

    const data = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    setOperators(data);
  };

  const createOperator = async () => {
    if (!name || !email) {
      return Alert.alert("Fill all fields");
    }

    const ref = await addDoc(collection(db, "users"), {
      name,
      email,
      role: "turf-operator",
      ownerId,
      status: "active",
      createdAt: serverTimestamp(),
    });

    setOperators((prev) => [
      ...prev,
      { id: ref.id, name, email, status: "active" },
    ]);

    setName("");
    setEmail("");
  };

  const toggleStatus = async (item) => {
    const newStatus = item.status === "active" ? "inactive" : "active";

    await updateDoc(doc(db, "users", item.id), {
      status: newStatus,
    });

    setOperators((prev) =>
      prev.map((op) =>
        op.id === item.id ? { ...op, status: newStatus } : op
      )
    );
  };

  const deleteOperator = async (item) => {
    await deleteDoc(doc(db, "users", item.id));
    setOperators((prev) => prev.filter((op) => op.id !== item.id));
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#081120" />

      <Text style={styles.title}>Operator Management</Text>

      {/* CREATE */}
      <TextInput
        placeholder="Operator Name"
        style={styles.input}
        value={name}
        onChangeText={setName}
      />

      <TextInput
        placeholder="Email"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />

      <TouchableOpacity style={styles.addBtn} onPress={createOperator}>
        <Text style={styles.btnText}>Create Operator</Text>
      </TouchableOpacity>

      {/* LIST */}
      <FlatList
        data={operators}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text>{item.email}</Text>

            <View style={styles.row}>
              <TouchableOpacity
                style={styles.statusBtn}
                onPress={() => toggleStatus(item)}
              >
                <Text style={styles.btnText}>
                  {item.status === "active" ? "Disable" : "Activate"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => deleteOperator(item)}
              >
                <Text style={styles.btnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#EEF4F7" },
  title: { fontSize: 24, fontWeight: "800", marginBottom: 10 },

  input: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },

  addBtn: {
    backgroundColor: "#081120",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 20,
  },

  card: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
  },

  name: { fontWeight: "700", fontSize: 16 },

  row: {
    flexDirection: "row",
    marginTop: 10,
  },

  statusBtn: {
    flex: 1,
    backgroundColor: "#0F766E",
    padding: 10,
    borderRadius: 8,
    marginRight: 5,
    alignItems: "center",
  },

  deleteBtn: {
    flex: 1,
    backgroundColor: "#C23030",
    padding: 10,
    borderRadius: 8,
    marginLeft: 5,
    alignItems: "center",
  },

  btnText: { color: "#fff", fontWeight: "600" },
});
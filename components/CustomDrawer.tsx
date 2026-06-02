import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
} from "react-native";

import {
  DrawerContentScrollView,
  DrawerItemList,
} from "@react-navigation/drawer";

import { Ionicons } from "@expo/vector-icons";
import { signOut } from "firebase/auth";
import { auth } from "../firebaseConfig";
import { useRouter } from "expo-router";

export default function CustomDrawer(props: any) {
  const router = useRouter();

  const logout = async () => {
    await signOut(auth);
    router.replace("/login");
  };

  return (
    
  );
}

const styles = StyleSheet.create({
  header: {
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },

  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#6366F1",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },

  avatarText: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
  },

  name: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
  },

  email: {
    color: "#9CA3AF",
    marginTop: 4,
    fontSize: 13,
  },

  menu: {
    flex: 1,
    paddingTop: 10,
  },

  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },

  logoutText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
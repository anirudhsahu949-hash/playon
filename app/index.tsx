import { Redirect } from "expo-router";
import { auth } from "../firebaseConfig";

export default function Index() {
  if (auth.currentUser) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(tabs)" />;
}
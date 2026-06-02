import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  initializeAuth,
  getReactNativePersistence,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyAHlLDc7qVuWzQ2IPK6avsnn4CEtIJqq4o",
  authDomain: "sportora-5f30f.firebaseapp.com",
  projectId: "sportora-5f30f",
  storageBucket: "sportora-5f30f.appspot.com", // ✅ fixed
  messagingSenderId: "465570382852",
  appId: "1:465570382852:web:0f5369b1743b5db0b12151",
};

const app =
  getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApps()[0];

export const db = getFirestore(app);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export { firebaseConfig };
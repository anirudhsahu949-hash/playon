import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  initializeAuth,
  getReactNativePersistence,
  browserLocalPersistence, // ← ADD THIS
} from "firebase/auth";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyAHlLDc7qVuWzQ2IPK6avsnn4CEtIJqq4o",
  authDomain: "sportora-5f30f.firebaseapp.com",
  projectId: "sportora-5f30f",
  storageBucket: "sportora-5f30f.appspot.com",
  messagingSenderId: "465570382852",
  appId: "1:465570382852:web:0f5369b1743b5db0b12151",
};

const app =
  getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApps()[0];

export const db = getFirestore(app);

// ✅ Platform-specific auth with browser persistence for web
export const auth = 
  Platform.OS === 'web'
    ? initializeAuth(app, {
        persistence: browserLocalPersistence, // Save login in browser
      })
    : initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });

export { firebaseConfig };
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useEffect, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { useRouter } from "expo-router";

export default function EditProfile() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [photo, setPhoto] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const uid = auth.currentUser?.uid;

      if (!uid) {
        setLoading(false);
        return;
      }

      const snap = await getDoc(doc(db, "users", uid));

      if (snap.exists()) {
        const data = snap.data();
        setName(data?.name || "");
        setEmail(data?.email || "");
        setPhone(data?.phone || "");
        setPhoto(data?.photo || "");
        setBusinessName(data?.businessName || "");
        setLocation(data?.location || "");
        setDescription(data?.description || "");
      }
    } catch (error) {
      console.log(error);
      Alert.alert("Error", "Unable to load profile details.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const uid = auth.currentUser?.uid;

    if (!uid) {
      Alert.alert("Error", "User not found.");
      return;
    }

    if (!name.trim() || !businessName.trim() || !location.trim()) {
      Alert.alert(
        "Missing fields",
        "Please fill name, business name, and location."
      );
      return;
    }

    try {
      setSaving(true);

      await updateDoc(doc(db, "users", uid), {
        name: name.trim(),
        phone: phone.trim(),
        photo: photo.trim(),
        businessName: businessName.trim(),
        location: location.trim(),
        description: description.trim(),
      });

      Alert.alert("Success", "Profile updated successfully.");
      router.back();
    } catch (error) {
      console.log(error);
      Alert.alert("Error", "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loaderContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#081120" />
        <ActivityIndicator size="large" color="#0F766E" />
        <Text style={styles.loaderText}>Loading profile editor...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#081120" />

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <View style={styles.headerGlowOne} />
          <View style={styles.headerGlowTwo} />

          <Text style={styles.headerTag}>Owner Settings</Text>
          <Text style={styles.title}>Edit Profile</Text>
          <Text style={styles.subtitle}>
            Update your business information, contact details, and profile image.
          </Text>
        </View>

        <View style={styles.previewCard}>
          <Image
            source={{
              uri:
                photo ||
                "https://cdn-icons-png.flaticon.com/512/149/149071.png",
            }}
            style={styles.avatar}
          />
          <View style={styles.previewTextWrap}>
            <Text style={styles.previewName}>{name || "Owner Name"}</Text>
            <Text style={styles.previewBusiness}>
              {businessName || "Business Name"}
            </Text>
            <Text style={styles.previewLocation}>
              {location || "Business Location"}
            </Text>
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>Personal Information</Text>

          <Text style={styles.label}>Full Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Enter your full name"
            placeholderTextColor="#7B8A97"
            style={styles.input}
          />

          <Text style={styles.label}>Email</Text>

<View style={styles.readonlyBox}>
  <Text style={styles.readonlyText}>
    {email || "No email found"}
  </Text>
</View>

          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="Enter phone number"
            placeholderTextColor="#7B8A97"
            style={styles.input}
            keyboardType="phone-pad"
          />

          <Text style={styles.sectionTitle}>Business Information</Text>

          <Text style={styles.label}>Business Name</Text>
          <TextInput
            value={businessName}
            onChangeText={setBusinessName}
            placeholder="Enter business name"
            placeholderTextColor="#7B8A97"
            style={styles.input}
          />

          <Text style={styles.label}>Location</Text>
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="Enter business location"
            placeholderTextColor="#7B8A97"
            style={styles.input}
          />

          <Text style={styles.label}>Profile Image URL</Text>
          <TextInput
            value={photo}
            onChangeText={setPhoto}
            placeholder="Enter image URL"
            placeholderTextColor="#7B8A97"
            style={styles.input}
            autoCapitalize="none"
          />

          <Text style={styles.label}>Business Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Write something about your business"
            placeholderTextColor="#7B8A97"
            style={[styles.input, styles.textArea]}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>
              {saving ? "Saving..." : "Save Changes"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.back()}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#EEF4F7",
  },

  container: {
    flex: 1,
    backgroundColor: "#EEF4F7",
  },

  content: {
    paddingBottom: 28,
  },

  loaderContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#EEF4F7",
  },

  loaderText: {
    marginTop: 12,
    fontSize: 15,
    color: "#4C6576",
    fontWeight: "600",
  },

  header: {
    backgroundColor: "#081120",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 30,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
  },

  headerGlowOne: {
    position: "absolute",
    top: -20,
    right: -30,
    width: 140,
    height: 140,
    borderRadius: 999,
    backgroundColor: "rgba(15,118,110,0.24)",
  },

  headerGlowTwo: {
    position: "absolute",
    bottom: -60,
    left: -40,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(56,189,248,0.10)",
  },

  headerTag: {
    color: "#9DB3C3",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  title: {
    marginTop: 8,
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  subtitle: {
    marginTop: 10,
    color: "#A8BFCE",
    fontSize: 14,
    lineHeight: 22,
    maxWidth: "94%",
  },

  previewCard: {
    marginHorizontal: 20,
    marginTop: -20,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#D8E3E9",
    flexDirection: "row",
    alignItems: "center",
  },

  avatar: {
    width: 78,
    height: 78,
    borderRadius: 999,
    backgroundColor: "#D6E3EA",
  },

  previewTextWrap: {
    marginLeft: 14,
    flex: 1,
  },

  previewName: {
    fontSize: 20,
    fontWeight: "800",
    color: "#081120",
  },

  previewBusiness: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "600",
    color: "#3A5261",
  },

  previewLocation: {
    marginTop: 4,
    fontSize: 13,
    color: "#607585",
  },

  formCard: {
    marginHorizontal: 20,
    marginTop: 18,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#D8E3E9",
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#081120",
    marginBottom: 14,
    marginTop: 8,
  },

  label: {
    color: "#6A7E8B",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
    marginTop: 10,
    textTransform: "uppercase",
  },

  input: {
    backgroundColor: "#F8FBFD",
    borderWidth: 1,
    borderColor: "#D8E3EA",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    color: "#081120",
  },

  textArea: {
    minHeight: 120,
  },

  primaryButton: {
    backgroundColor: "#081120",
    paddingVertical: 15,
    borderRadius: 15,
    alignItems: "center",
    marginTop: 24,
  },

  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },

  secondaryButton: {
    backgroundColor: "#E8EEF2",
    paddingVertical: 15,
    borderRadius: 15,
    alignItems: "center",
    marginTop: 12,
  },

  secondaryButtonText: {
    color: "#081120",
    fontWeight: "700",
    fontSize: 15,
  },
  readonlyBox: {
  backgroundColor: "#EEF3F6",
  borderWidth: 1,
  borderColor: "#D8E3EA",
  borderRadius: 14,
  paddingHorizontal: 14,
  paddingVertical: 14,
},

readonlyText: {
  fontSize: 15,
  color: "#607585",
  fontWeight: "600",
},
});

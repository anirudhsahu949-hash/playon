import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Image,
  Platform,
} from "react-native";
import { useEffect, useState } from "react";
import { db } from "../../firebaseConfig";
import {
  doc,
  getDoc,
  updateDoc,
  getDocs,
  collection,
} from "firebase/firestore";
import { useLocalSearchParams, useRouter } from "expo-router";

type OwnerItem = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
};

export default function EditTurf() {
  const { id } = useLocalSearchParams();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [dayPrice, setDayPrice] = useState("");
  const [nightPrice, setNightPrice] = useState("");
  const [price, setPrice] = useState("");
  const [sport, setSport] = useState("");
  const [mapLink, setMapLink] = useState("");

  const [openingTime, setOpeningTime] = useState("6");
  const [closingTime, setClosingTime] = useState("24");
  const [slotDuration, setSlotDuration] = useState("60");

  const [images, setImages] = useState<string[]>([]);
  const [coverImage, setCoverImage] = useState("");
  const [imageInput, setImageInput] = useState("");

  const [owners, setOwners] = useState<OwnerItem[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<OwnerItem | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    await Promise.all([fetchTurf(), fetchOwners()]);
  };

  const fetchTurf = async () => {
    try {
      const turfId = String(id || "");
      const snap = await getDoc(doc(db, "turfs", turfId));

      if (!snap.exists()) {
        Alert.alert("Not Found", "This turf does not exist.");
        router.back();
        return;
      }

      const data: any = snap.data();

      setName(data.name || "");
      setLocation(data.location || "");
      setPrice(String(data.price_per_hour || data.price || ""));
      setDayPrice(String(data.dayPrice || ""));
      setNightPrice(String(data.nightPrice || ""));
      setSport(data.sport || "");
      setMapLink(data.mapLink || "");
      setOpeningTime(String(data.openingTime ?? "6"));
      setClosingTime(String(data.closingTime ?? "24"));
      setSlotDuration(String(data.slotDuration ?? "60"));
      setImages(data.images || []);
      setCoverImage(data.image || "");

      if (data.ownerId) {
        setSelectedOwner({
          id: data.ownerId,
          name: data.ownerName || "Owner",
          email: data.ownerEmail || "",
        });
      }
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Error loading turf.");
    } finally {
      setLoading(false);
    }
  };

  const fetchOwners = async () => {
    try {
      const snap = await getDocs(collection(db, "users"));

      const data = snap.docs
        .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
        .filter((user: any) => user.role === "owner") as OwnerItem[];

      setOwners(data);
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Unable to load owners.");
    }
  };

  const addImage = () => {
    if (!imageInput.trim()) return;
    setImages((prev) => [...prev, imageInput.trim()]);
    setImageInput("");
  };

  const removeImage = (index: number) => {
    const updated = [...images];
    updated.splice(index, 1);
    setImages(updated);
  };

  const validateForm = () => {
    if (!name.trim()) return "Turf name is required.";
    if (!location.trim()) return "Location is required.";
    if (!selectedOwner) return "Please select an owner.";
    if (!sport.trim()) return "Sport is required.";

    if (price && (Number.isNaN(Number(price)) || Number(price) < 0)) {
      return "Base price must be valid.";
    }

    if (dayPrice && (Number.isNaN(Number(dayPrice)) || Number(dayPrice) < 0)) {
      return "Day price must be valid.";
    }

    if (
      nightPrice &&
      (Number.isNaN(Number(nightPrice)) || Number(nightPrice) < 0)
    ) {
      return "Night price must be valid.";
    }

    if (
      Number.isNaN(Number(openingTime)) ||
      Number(openingTime) < 0 ||
      Number(openingTime) > 24
    ) {
      return "Opening time must be between 0 and 24.";
    }

    if (
      Number.isNaN(Number(closingTime)) ||
      Number(closingTime) < 1 ||
      Number(closingTime) > 24
    ) {
      return "Closing time must be between 1 and 24.";
    }

    if (Number(closingTime) <= Number(openingTime)) {
      return "Closing time must be greater than opening time.";
    }

    if (
      Number.isNaN(Number(slotDuration)) ||
      Number(slotDuration) <= 0
    ) {
      return "Slot duration must be valid.";
    }

    return null;
  };

  const handleUpdate = async () => {
    const error = validateForm();
    if (error) {
      Alert.alert("Invalid Details", error);
      return;
    }

    try {
      setSaving(true);

      await updateDoc(doc(db, "turfs", String(id)), {
        name: name.trim(),
        location: location.trim(),
        price_per_hour: price ? Number(price) : Number(dayPrice || 0),
        price: price ? Number(price) : Number(dayPrice || 0),
        dayPrice: dayPrice ? Number(dayPrice) : Number(price || 0),
        nightPrice: nightPrice ? Number(nightPrice) : Number(price || 0),
        sport: sport.trim(),
        image: coverImage.trim() || images[0] || "",
        images,
        mapLink: mapLink.trim(),
        openingTime: Number(openingTime),
        closingTime: Number(closingTime),
        slotDuration: Number(slotDuration),
        ownerId: selectedOwner?.id || "",
        ownerName: selectedOwner?.name || "",
        ownerEmail: selectedOwner?.email || "",
      });

      Alert.alert("Success", "Turf updated successfully.");
      router.back();
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Error updating turf.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loader}>
        <StatusBar barStyle="light-content" backgroundColor="#081120" />
        <ActivityIndicator size="large" color="#0F766E" />
        <Text style={styles.loaderText}>Loading turf details...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#081120" />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerGlowOne} />
          <View style={styles.headerGlowTwo} />

          <Text style={styles.headerTag}>Admin Panel</Text>
          <Text style={styles.title}>Edit Turf</Text>
          <Text style={styles.subtitle}>
            Update turf details, pricing, timings, images, and owner assignment.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Basic Details</Text>

          <Text style={styles.label}>Turf Name</Text>
          <TextInput
            value={name}
            style={styles.input}
            onChangeText={setName}
            placeholder="Enter turf name"
            placeholderTextColor="#7B8A97"
          />

          <Text style={styles.label}>Location</Text>
          <TextInput
            value={location}
            style={styles.input}
            onChangeText={setLocation}
            placeholder="Enter turf location"
            placeholderTextColor="#7B8A97"
          />

          <Text style={styles.label}>Sport</Text>
          <TextInput
            value={sport}
            style={styles.input}
            onChangeText={setSport}
            placeholder="Football, Cricket, Badminton"
            placeholderTextColor="#7B8A97"
          />

          <Text style={styles.label}>Base Price</Text>
          <TextInput
            value={price}
            style={styles.input}
            onChangeText={setPrice}
            keyboardType="numeric"
            placeholder="Enter price"
            placeholderTextColor="#7B8A97"
          />

          <Text style={styles.label}>Day Price</Text>
          <TextInput
            value={dayPrice}
            style={styles.input}
            onChangeText={setDayPrice}
            keyboardType="numeric"
            placeholder="6 AM - 6 PM"
            placeholderTextColor="#7B8A97"
          />

          <Text style={styles.label}>Night Price</Text>
          <TextInput
            value={nightPrice}
            style={styles.input}
            onChangeText={setNightPrice}
            keyboardType="numeric"
            placeholder="6 PM - 6 AM"
            placeholderTextColor="#7B8A97"
          />

          <Text style={styles.label}>Google Map Link</Text>
          <TextInput
            value={mapLink}
            style={styles.input}
            onChangeText={setMapLink}
            placeholder="Paste Google Map link"
            placeholderTextColor="#7B8A97"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Timings</Text>

          <Text style={styles.label}>Opening Time</Text>
          <TextInput
            value={openingTime}
            style={styles.input}
            onChangeText={setOpeningTime}
            keyboardType="numeric"
            placeholder="Example: 6"
            placeholderTextColor="#7B8A97"
          />

          <Text style={styles.label}>Closing Time</Text>
          <TextInput
            value={closingTime}
            style={styles.input}
            onChangeText={setClosingTime}
            keyboardType="numeric"
            placeholder="Example: 24"
            placeholderTextColor="#7B8A97"
          />

          <Text style={styles.label}>Slot Duration</Text>
          <TextInput
            value={slotDuration}
            style={styles.input}
            onChangeText={setSlotDuration}
            keyboardType="numeric"
            placeholder="Example: 60"
            placeholderTextColor="#7B8A97"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Images</Text>

          <Text style={styles.label}>Cover Image</Text>
          <TextInput
            value={coverImage}
            style={styles.input}
            onChangeText={setCoverImage}
            placeholder="Main image URL"
            placeholderTextColor="#7B8A97"
          />

          {!!(coverImage || images[0]) && (
            <Image
              source={{ uri: coverImage || images[0] }}
              style={styles.previewImage}
            />
          )}

          <Text style={styles.label}>Gallery Images</Text>
          <View style={styles.imageInputRow}>
            <TextInput
              placeholder="Image URL"
              placeholderTextColor="#7B8A97"
              style={[styles.input, styles.imageInput]}
              value={imageInput}
              onChangeText={setImageInput}
            />

            <TouchableOpacity style={styles.addBtn} onPress={addImage}>
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          </View>

          {images.length > 0 && (
            <FlatList
              horizontal
              data={images}
              keyExtractor={(item, index) => `${item}-${index}`}
              showsHorizontalScrollIndicator={false}
              renderItem={({ index }) => (
                <TouchableOpacity
                  style={styles.imageTag}
                  onPress={() => removeImage(index)}
                >
                  <Text style={styles.imageTagText}>
                    Image {index + 1} Remove
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Assign Owner</Text>

          <FlatList
            horizontal
            data={owners}
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => {
              const selected = selectedOwner?.id === item.id;

              return (
                <TouchableOpacity
                  style={[
                    styles.ownerBox,
                    selected && styles.ownerBoxSelected,
                  ]}
                  onPress={() => setSelectedOwner(item)}
                >
                  <Text
                    style={[
                      styles.ownerName,
                      selected && styles.ownerNameSelected,
                    ]}
                  >
                    {item.name || "Owner"}
                  </Text>

                  <Text
                    style={[
                      styles.ownerEmail,
                      selected && styles.ownerEmailSelected,
                    ]}
                  >
                    {item.email || "No email"}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>

        <TouchableOpacity
          style={styles.btn}
          onPress={handleUpdate}
          disabled={saving}
        >
          <Text style={styles.btnText}>
            {saving ? "Updating..." : "Update Turf"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => router.back()}
          disabled={saving}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
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

  contentContainer: {
    paddingBottom: 32,
  },

  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#EEF4F7",
  },

  loaderText: {
    marginTop: 12,
    color: "#4C6576",
    fontSize: 15,
    fontWeight: "600",
  },

  header: {
    backgroundColor: "#081120",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 12 : 24,
    paddingBottom: 30,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
  },

  headerGlowOne: {
    position: "absolute",
    top: -20,
    right: -30,
    width: 150,
    height: 150,
    borderRadius: 999,
    backgroundColor: "rgba(15,118,110,0.20)",
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
    color: "#9CB4C4",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  title: {
    marginTop: 8,
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
  },

  subtitle: {
    marginTop: 10,
    color: "#A8BFCE",
    fontSize: 14,
    lineHeight: 22,
    maxWidth: "95%",
  },

  section: {
    marginTop: 18,
    marginHorizontal: 20,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#D7E2EA",
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#081120",
    marginBottom: 10,
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
    marginBottom: 10,
  },

  previewImage: {
    width: "100%",
    height: 180,
    borderRadius: 18,
    marginTop: 6,
    backgroundColor: "#D9E4EC",
  },

  imageInputRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  imageInput: {
    flex: 1,
    marginBottom: 0,
  },

  addBtn: {
    backgroundColor: "#081120",
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderRadius: 14,
    marginLeft: 10,
  },

  addBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },

  imageTag: {
    backgroundColor: "#081120",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 14,
    marginRight: 10,
  },

  imageTagText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 13,
  },

  ownerBox: {
    width: 220,
    padding: 14,
    marginRight: 12,
    backgroundColor: "#F8FBFD",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D8E3EA",
  },

  ownerBoxSelected: {
    backgroundColor: "#081120",
    borderColor: "#081120",
  },

  ownerName: {
    color: "#081120",
    fontSize: 16,
    fontWeight: "800",
  },

  ownerNameSelected: {
    color: "#FFFFFF",
  },

  ownerEmail: {
    marginTop: 6,
    color: "#607585",
    fontSize: 13,
  },

  ownerEmailSelected: {
    color: "#C7D5DE",
  },

  btn: {
    backgroundColor: "#081120",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    marginTop: 22,
    marginHorizontal: 20,
  },

  btnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },

  cancelBtn: {
    backgroundColor: "#E8EEF2",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    marginTop: 12,
    marginHorizontal: 20,
  },

  cancelBtnText: {
    color: "#081120",
    fontWeight: "700",
    fontSize: 15,
  },
});

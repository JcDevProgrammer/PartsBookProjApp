import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { ref, listAll, getDownloadURL } from "firebase/storage";
import { WebView } from "react-native-webview";
import * as Print from "expo-print";

export default function AllPDFScreen() {
  const [loading, setLoading] = useState(false);

  const [allFiles, setAllFiles] = useState([]);

  const [searchQuery, setSearchQuery] = useState("");

  const [selectedFileUrl, setSelectedFileUrl] = useState(null);

  useEffect(() => {
    fetchAllFiles();
  }, []);

  async function fetchAllFiles() {
    try {
      setLoading(true);

      const rootRef = ref(storage, "");
      let queue = [{ prefixRef: rootRef, depth: 0 }];
      let visited = new Set();
      let filesFound = [];

      while (queue.length > 0) {
        const { prefixRef, depth } = queue.shift();
        if (visited.has(prefixRef.fullPath)) continue;
        visited.add(prefixRef.fullPath);

        const result = await listAll(prefixRef);

        const filePromises = result.items.map(async (itemRef) => {
          const url = await getDownloadURL(itemRef);
          return {
            name: itemRef.name,
            path: itemRef.fullPath,
            url,
          };
        });
        const newFiles = await Promise.all(filePromises);
        filesFound.push(...newFiles);

        if (depth < 1) {
          for (let prefix of result.prefixes) {
            queue.push({ prefixRef: prefix, depth: depth + 1 });
          }
        }
      }

      setAllFiles(filesFound);
    } catch (error) {
      console.error("Error fetching files via BFS:", error);
      Alert.alert("Error", "Failed to fetch files from Firebase.");
    } finally {
      setLoading(false);
    }
  }

  const filteredFiles = allFiles.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleViewFile = (fileUrl) => {
    setSelectedFileUrl(fileUrl);
  };

  // Print the currently selected PDF
  const handlePrint = async () => {
    if (!selectedFileUrl) return;
    try {
      if (Platform.OS === "web") {
        const printWindow = window.open(selectedFileUrl, "_blank");
        printWindow?.print();
      } else {
        await Print.printAsync({ uri: selectedFileUrl });
      }
    } catch (error) {
      console.error("Print error:", error);
      Alert.alert("Print Error", "Failed to print the PDF.");
    }
  };

  const handleEdit = () => {
    Alert.alert("Edit PDF", "PDF editing is not implemented yet.");
  };

  if (selectedFileUrl) {
    return (
      <View style={styles.viewerContainer}>
        {}
        <View style={styles.viewerHeader}>
          <TouchableOpacity onPress={() => setSelectedFileUrl(null)}>
            <Text style={styles.headerButton}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>PDF Viewer</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handlePrint}>
              <Text style={styles.headerButton}>Print</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleEdit}>
              <Text style={styles.headerButton}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>

        {}
        <WebView
          source={{ uri: selectedFileUrl }}
          style={{ flex: 1 }}
          startInLoadingState
          renderLoading={() => (
            <ActivityIndicator
              size="large"
              color="#283593"
              style={{ marginTop: 20 }}
            />
          )}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>All PDF Files</Text>
      </View>

      {}
      <View style={styles.searchBarContainer}>
        <TextInput
          style={styles.searchBar}
          placeholder="Search file name..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {}
      {loading && (
        <ActivityIndicator
          size="large"
          color="#283593"
          style={{ marginTop: 20 }}
        />
      )}

      {}
      {!loading && (
        <FlatList
          data={filteredFiles}
          keyExtractor={(item) => item.path}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.fileItem}
              onPress={() => handleViewFile(item.url)}
            >
              <Text style={styles.fileName}>{item.name}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EDEDED",
  },
  header: {
    backgroundColor: "#283593",
    paddingTop: 40,
    paddingBottom: 15,
    alignItems: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  searchBarContainer: {
    backgroundColor: "#EDEDED",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchBar: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
  },
  listContent: {
    paddingHorizontal: 10,
    paddingBottom: 20,
  },
  fileItem: {
    backgroundColor: "#fff",
    marginVertical: 6,
    borderRadius: 8,
    padding: 10,
    justifyContent: "center",
  },
  fileName: {
    fontSize: 16,
    color: "#333",
  },

  viewerContainer: {
    flex: 1,
    backgroundColor: "#EDEDED",
  },
  viewerHeader: {
    flexDirection: "row",
    backgroundColor: "#283593",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 40,
    paddingBottom: 15,
    paddingHorizontal: 10,
  },
  headerActions: {
    flexDirection: "row",
  },
  headerButton: {
    color: "#fff",
    fontSize: 16,
    marginHorizontal: 8,
  },
});

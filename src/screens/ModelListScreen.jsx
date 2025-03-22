import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  FlatList,
  ActivityIndicator,
  TextInput,
  Alert,
  Platform,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system";
import { ref, listAll, getDownloadURL } from "firebase/storage";
import { storage } from "../config/firebaseConfig";
import PdfViewer from "../../components/PdfViewer";

const FolderItem = React.memo(
  ({ item, isExpanded, onToggleFolder, onOpenFile }) => (
    <View style={styles.folderContainer}>
      <TouchableOpacity
        style={styles.folderRow}
        onPress={() => onToggleFolder(item.folderName)}
      >
        <View style={styles.folderHeader}>
          <Text style={styles.folderTitle}>{item.folderName}</Text>
          {item.files && item.files.length > 0 && (
            <Text style={styles.folderCount}>({item.files.length} items)</Text>
          )}
        </View>
        <Image
          source={require("../../assets/icons/arrow.png")}
          style={[
            styles.arrowIcon,
            isExpanded && { transform: [{ rotate: "180deg" }] },
          ]}
        />
      </TouchableOpacity>
      {isExpanded && (
        <View style={styles.fileList}>
          {item.loading ? (
            <ActivityIndicator size="small" color="#283593" />
          ) : item.files && item.files.length > 0 ? (
            item.files.map((f, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.fileItem}
                onPress={() => onOpenFile(f.url)}
              >
                <Text style={styles.fileName}>{f.name}</Text>
                <Text style={styles.filePath}>{f.path}</Text>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.noFilesText}>No files found.</Text>
          )}
        </View>
      )}
    </View>
  )
);

export default function ModelListScreen() {
  const router = useRouter();
  const [topFolders, setTopFolders] = useState([]);
  const [loadingRoot, setLoadingRoot] = useState(true);
  const [subfolderData, setSubfolderData] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolder, setExpandedFolder] = useState(null);
  const [selectedPdfBase64, setSelectedPdfBase64] = useState(null);
  const [selectedFileUrl, setSelectedFileUrl] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [showInfoMenu, setShowInfoMenu] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const pdfViewerRef = useRef(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected && state.isInternetReachable;
      setIsOnline(!!online);
    });
    if (isOnline) {
      fetchTopLevelFolders();
    } else {
      loadCachedData();
    }
    return () => unsubscribe();
  }, [isOnline]);

  // Polling mechanism: refresh folders and expanded folder contents every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (isOnline) {
        fetchTopLevelFolders();
        if (expandedFolder) {
          fetchSubfolderContents(expandedFolder);
        }
      }
    }, 30000); // 30 seconds; adjust as needed
    return () => clearInterval(interval);
  }, [isOnline, expandedFolder]);

  const fetchTopLevelFolders = async () => {
    try {
      setLoadingRoot(true);
      const rootRef = ref(storage, "");
      const rootResult = await listAll(rootRef);
      const folderNames = rootResult.prefixes.map((f) => f.name);
      setTopFolders(folderNames);
      await AsyncStorage.setItem("@cachedFolders", JSON.stringify(folderNames));
    } catch (error) {
      console.error("Error fetching top-level folders:", error);
    } finally {
      setLoadingRoot(false);
    }
  };

  const loadCachedData = async () => {
    try {
      setLoadingRoot(true);
      const cachedFolders = await AsyncStorage.getItem("@cachedFolders");
      if (cachedFolders) {
        setTopFolders(JSON.parse(cachedFolders));
      }
    } catch (error) {
      console.error("Error loading cached data:", error);
    } finally {
      setLoadingRoot(false);
    }
  };

  async function fetchFolderRecursively(prefixRef, depth = 0, maxDepth = 1) {
    try {
      const result = await listAll(prefixRef);
      const filePromises = result.items.map(async (itemRef) => {
        const httpsUrl = await getDownloadURL(itemRef);
        return { name: itemRef.name, path: itemRef.fullPath, url: httpsUrl };
      });
      const files = await Promise.all(filePromises);
      if (depth < maxDepth) {
        const subPromises = result.prefixes.map((subRef) =>
          fetchFolderRecursively(subRef, depth + 1, maxDepth)
        );
        const subFilesArrays = await Promise.all(subPromises);
        return files.concat(...subFilesArrays);
      }
      return files;
    } catch (err) {
      console.error("Error BFS:", err);
      return [];
    }
  }

  const fetchSubfolderContents = async (folderName) => {
    if (!isOnline) {
      Alert.alert("Offline", "No internet. Can't fetch data.");
      return;
    }
    try {
      setSubfolderData((prev) => ({
        ...prev,
        [folderName]: { ...prev[folderName], loading: true },
      }));
      const folderRef = ref(storage, folderName + "/");
      const files = await fetchFolderRecursively(folderRef);
      setSubfolderData((prev) => ({
        ...prev,
        [folderName]: { files, loading: false, loaded: true },
      }));
      await AsyncStorage.setItem(
        `@cachedSubfolder_${folderName}`,
        JSON.stringify(files)
      );
    } catch (error) {
      console.error("Error fetching subfolder:", error);
      setSubfolderData((prev) => ({
        ...prev,
        [folderName]: { ...prev[folderName], loading: false },
      }));
    }
  };

  const loadCachedSubfolder = async (folderName) => {
    try {
      const cached = await AsyncStorage.getItem(
        `@cachedSubfolder_${folderName}`
      );
      if (cached) {
        const files = JSON.parse(cached);
        setSubfolderData((prev) => ({
          ...prev,
          [folderName]: { files, loading: false, loaded: true },
        }));
      } else {
        Alert.alert("Offline", "No cached data for this folder.");
      }
    } catch (err) {
      console.error("Error loading cached subfolder:", err);
    }
  };

  const handleToggleFolder = async (folderName) => {
    if (expandedFolder === folderName) {
      setExpandedFolder(null);
      return;
    }
    setExpandedFolder(folderName);
    const currentData = subfolderData[folderName];
    if (!currentData || !currentData.loaded) {
      if (isOnline) {
        fetchSubfolderContents(folderName);
      } else {
        await loadCachedSubfolder(folderName);
      }
    }
  };

  const handleOpenFile = async (url) => {
    if (!isOnline) {
      Alert.alert("Offline", "Cannot view PDF offline (needs internet).");
      return;
    }
    if (Platform.OS === "web") {
      setSelectedFileUrl(url);
      return;
    }
    try {
      setIsDownloading(true);
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Failed to fetch PDF. Status: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ""
        )
      );
      setSelectedPdfBase64(base64);
    } catch (error) {
      Alert.alert("Error", "Failed to download PDF: " + error.message);
      console.error("Error downloading PDF:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Info", "Printing not supported on web in this snippet.");
    } else if (selectedPdfBase64) {
      try {
        const fileUri = FileSystem.cacheDirectory + "temp.pdf";
        await FileSystem.writeAsStringAsync(fileUri, selectedPdfBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await Print.printAsync({ uri: fileUri });
      } catch (error) {
        Alert.alert("Error", "Failed to print PDF: " + error.message);
      }
    }
  };

  const handleSearch = () => {
    if (Platform.OS !== "web" && pdfViewerRef.current) {
      pdfViewerRef.current.postMessage("focusSearch");
    } else {
      Alert.alert("Search", "Please use the browser's find (Ctrl+F) feature.");
    }
  };

  const toggleInfoMenu = () => setShowInfoMenu((prev) => !prev);
  const goToHome = () => {
    setShowInfoMenu(false);
    router.push("/home-screen");
  };

  const filteredData = useMemo(() => {
    return topFolders.reduce((acc, folderName) => {
      const subData = subfolderData[folderName] || {};
      const folderMatch = folderName
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const filteredFiles =
        subData.files && searchQuery
          ? subData.files.filter(
              (file) =>
                file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                file.path.toLowerCase().includes(searchQuery.toLowerCase())
            )
          : subData.files || [];
      if (folderMatch || filteredFiles.length > 0 || !searchQuery) {
        acc.push({
          folderName,
          files: filteredFiles,
          loading: subData.loading,
        });
      }
      return acc;
    }, []);
  }, [topFolders, subfolderData, searchQuery]);

  if (Platform.OS === "web" && selectedFileUrl) {
    return (
      <View style={styles.viewerContainer}>
        <View style={styles.viewerHeader}>
          <TouchableOpacity onPress={() => setSelectedFileUrl(null)}>
            <Image
              source={require("../../assets/icons/back.png")}
              style={styles.viewerIcon}
            />
          </TouchableOpacity>
          <Text style={styles.viewerTitle}>PDF Viewer</Text>
          <View style={styles.viewerActions}>
            <TouchableOpacity onPress={handlePrint}>
              <Image
                source={require("../../assets/icons/printer.png")}
                style={styles.viewerIcon}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                Alert.alert(
                  "Search",
                  "Please use the browser's find (Ctrl+F) feature for search functionality."
                )
              }
            >
              <Image
                source={require("../../assets/icons/search.png")}
                style={styles.viewerIcon}
              />
            </TouchableOpacity>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <PdfViewer uri={selectedFileUrl} />
        </View>
      </View>
    );
  }

  if (selectedPdfBase64) {
    return (
      <View style={styles.viewerContainer}>
        <View style={styles.viewerHeader}>
          <TouchableOpacity onPress={() => setSelectedPdfBase64(null)}>
            <Image
              source={require("../../assets/icons/back.png")}
              style={styles.viewerIcon}
            />
          </TouchableOpacity>
          <Text style={styles.viewerTitle}>PDF Viewer</Text>
          <View style={styles.viewerActions}>
            <TouchableOpacity onPress={handlePrint}>
              <Image
                source={require("../../assets/icons/printer.png")}
                style={styles.viewerIcon}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSearch}>
              <Image
                source={require("../../assets/icons/search.png")}
                style={styles.viewerIcon}
              />
            </TouchableOpacity>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <PdfViewer ref={pdfViewerRef} base64Data={selectedPdfBase64} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isDownloading && (
        <View style={styles.downloadOverlay}>
          <View style={styles.downloadBox}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.downloadText}>Downloading PDF...</Text>
          </View>
        </View>
      )}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Image
            source={require("../../assets/icons/back.png")}
            style={styles.headerIcon}
          />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Please select a model</Text>
        <TouchableOpacity onPress={toggleInfoMenu}>
          <Image
            source={require("../../assets/icons/info.png")}
            style={styles.headerIcon}
          />
        </TouchableOpacity>
      </View>
      {showInfoMenu && (
        <View style={styles.infoMenu}>
          <Text style={styles.infoMenuTitle}>
            @jcrice13/GT_ISM_PartsBookProject
          </Text>
          <Text style={styles.infoMenuDescription}>
            Build for internal distribution.
          </Text>
          <TouchableOpacity
            style={styles.infoMenuButton}
            onPress={() => {
              setShowInfoMenu(false);
              setShowQRCode(true);
            }}
          >
            <Text style={styles.infoMenuButtonText}>Download for Mobile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.infoMenuButton} onPress={goToHome}>
            <Text style={styles.infoMenuButtonText}>Go to Home</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.searchContainer}>
        {!isOnline && (
          <Text style={{ color: "red", marginBottom: 5 }}>
            Offline mode. Showing cached data (if available).
          </Text>
        )}
        <TextInput
          style={styles.searchBar}
          placeholder="Search folder or PDF Name..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>
      {loadingRoot ? (
        <ActivityIndicator
          size="large"
          color="#283593"
          style={{ marginTop: 20 }}
        />
      ) : filteredData.length > 0 ? (
        <FlatList
          data={filteredData}
          keyExtractor={(item) => item.folderName}
          initialNumToRender={5}
          renderItem={({ item }) => (
            <FolderItem
              item={item}
              isExpanded={expandedFolder === item.folderName}
              onToggleFolder={handleToggleFolder}
              onOpenFile={handleOpenFile}
            />
          )}
        />
      ) : (
        <View style={styles.noMatchContainer}>
          <Text style={styles.noMatchText}>
            {isOnline
              ? "No folders or PDFs match your search."
              : "No offline data available."}
          </Text>
        </View>
      )}
      <Modal
        visible={showQRCode}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowQRCode(false)}
      >
        <View style={styles.modalContainer}>
          <View
            style={[
              styles.modalContent,
              { maxWidth: Platform.OS === "web" ? 600 : 500 },
            ]}
          >
            <Text
              style={[
                styles.qrHeader,
                { fontSize: Platform.OS === "web" ? 24 : 18 },
              ]}
            >
              Access on Mobile
            </Text>
            <Image
              source={require("../../assets/images/qr-code.png")}
              style={[
                styles.qrImage,
                {
                  width: Platform.OS === "web" ? 240 : 280,
                  height: Platform.OS === "web" ? 240 : 280,
                },
              ]}
            />
            <Text
              style={[
                styles.qrDescription,
                { fontSize: Platform.OS === "web" ? 16 : 14 },
              ]}
            >
              Scan this QR code with your mobile device to quickly access our
              website and enjoy a seamless browsing experience on the go.
            </Text>
            <TouchableOpacity
              onPress={() => setShowQRCode(false)}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#EDEDED" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#283593",
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 10,
    justifyContent: "space-between",
  },
  headerIcon: { width: 25, height: 25, tintColor: "#fff" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  infoMenu: {
    position: "absolute",
    top: 70,
    right: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    zIndex: 999,
    padding: 10,
  },
  infoMenuTitle: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 5,
    color: "#283593",
  },
  infoMenuDescription: {
    fontSize: 12,
    color: "#666",
    marginBottom: 10,
  },
  infoMenuButton: { paddingVertical: 5 },
  infoMenuButtonText: {
    fontSize: 14,
    color: "#333",
    textDecorationLine: "underline",
  },
  searchContainer: { padding: 10, backgroundColor: "#EDEDED" },
  searchBar: {
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    fontSize: 16,
  },
  folderContainer: {
    backgroundColor: "#fff",
    marginHorizontal: 10,
    marginTop: 10,
    borderRadius: 8,
    overflow: "hidden",
  },
  folderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15,
  },
  folderHeader: { flexDirection: "row", alignItems: "center" },
  folderTitle: { fontSize: 16, color: "#333", fontWeight: "bold" },
  folderCount: { fontSize: 14, color: "#666", marginLeft: 5 },
  arrowIcon: { width: 20, height: 20, tintColor: "#333" },
  fileList: {
    backgroundColor: "#f9f9f9",
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  fileItem: {
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#ccc",
  },
  fileName: { fontSize: 16, color: "#283593", fontWeight: "600" },
  filePath: { fontSize: 12, color: "#666", marginTop: 2 },
  noFilesText: { fontSize: 14, color: "#666", fontStyle: "italic" },
  noMatchContainer: { marginTop: 40, alignItems: "center" },
  noMatchText: { fontSize: 16, color: "#666" },
  viewerContainer: { flex: 1, backgroundColor: "#EDEDED" },
  viewerHeader: {
    flexDirection: "row",
    backgroundColor: "#283593",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 20,
    paddingBottom: 15,
    paddingHorizontal: 10,
  },
  viewerTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  viewerActions: { flexDirection: "row" },
  viewerIcon: {
    width: 25,
    height: 25,
    tintColor: "#fff",
    marginHorizontal: 8,
  },
  downloadOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    zIndex: 999,
    justifyContent: "center",
    alignItems: "center",
  },
  downloadBox: {
    backgroundColor: "#333",
    padding: 20,
    borderRadius: 10,
    alignItems: "center",
  },
  downloadText: { color: "#fff", marginTop: 10, fontSize: 16 },
  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
  },
  modalContent: {
    width: "90%",
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 20,
    alignItems: "center",
  },
  qrHeader: {
    fontWeight: "bold",
    color: "#283593",
    marginBottom: 15,
  },
  qrImage: { marginBottom: 15 },
  qrDescription: {
    color: "#333",
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 22,
  },
  closeButton: {
    backgroundColor: "#283593",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  closeButtonText: { color: "#fff", fontSize: 14 },
});

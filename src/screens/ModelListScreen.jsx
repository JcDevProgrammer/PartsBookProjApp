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

// ========== Import Google Drive functions ==========
import { getTopLevelItems, getDriveItems } from "../config/googleDrive";

import PdfViewer from "../../components/PdfViewer";

// Render each folder item
const FolderItem = React.memo(
  ({ item, isExpanded, onToggleFolder, onOpenFile }) => (
    <View style={styles.folderContainer}>
      <TouchableOpacity
        style={styles.folderRow}
        onPress={() => onToggleFolder(item)}
      >
        <View style={styles.folderHeader}>
          <Text style={styles.folderTitle}>{item.name}</Text>
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
                onPress={() => onOpenFile(f)}
              >
                <Text style={styles.fileName}>{f.name}</Text>
                <Text style={styles.filePath}>{f.id}</Text>
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

  // States for folders + subfolders
  const [topFolders, setTopFolders] = useState([]);
  const [subfolderData, setSubfolderData] = useState({});

  // UI states
  const [loadingRoot, setLoadingRoot] = useState(true);
  const [expandedFolder, setExpandedFolder] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // PDF Viewing
  const [selectedPdfBase64, setSelectedPdfBase64] = useState(null);

  // Network, info menu, QR code
  const [isOnline, setIsOnline] = useState(true);
  const [showInfoMenu, setShowInfoMenu] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);

  const pdfViewerRef = useRef(null);

  // Check network + fetch
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

  // Get top-level folders from Google Drive
  const fetchTopLevelFolders = async () => {
    try {
      setLoadingRoot(true);
      const items = await getTopLevelItems();
      const folderData = items.filter(
        (it) => it.mimeType === "application/vnd.google-apps.folder"
      );
      folderData.sort((a, b) => a.name.localeCompare(b.name));
      setTopFolders(folderData);
      await AsyncStorage.setItem("@cachedFolders", JSON.stringify(folderData));
    } catch (error) {
      console.error("Error fetching top-level folders:", error);
    } finally {
      setLoadingRoot(false);
    }
  };

  // Load cached data if offline
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

  // BFS to get all items
  async function fetchAllDriveItems(
    folderId,
    pageToken = null,
    accumulated = []
  ) {
    const items = await getDriveItems(folderId, pageToken);
    const newAccumulated = [...accumulated, ...items.files];
    if (items.nextPageToken) {
      return fetchAllDriveItems(folderId, items.nextPageToken, newAccumulated);
    } else {
      return newAccumulated;
    }
  }

  // BFS for subfolders
  async function fetchFolderRecursively(folderId, depth = 0, maxDepth = 10) {
    try {
      const allItems = await fetchAllDriveItems(folderId);
      const files = [];
      const subfolders = [];
      for (let it of allItems) {
        if (it.mimeType === "application/vnd.google-apps.folder") {
          subfolders.push(it);
        } else {
          files.push({
            name: it.name,
            id: it.id,
            url: it.webContentLink,
          });
        }
      }
      if (depth < maxDepth) {
        for (let sf of subfolders) {
          const deeperFiles = await fetchFolderRecursively(
            sf.id,
            depth + 1,
            maxDepth
          );
          files.push(...deeperFiles);
        }
      }
      return files;
    } catch (err) {
      console.error("Error BFS in Google Drive:", err);
      return [];
    }
  }

  // Get subfolder contents
  const fetchSubfolderContents = async (folder) => {
    if (!isOnline) {
      Alert.alert("Offline", "No internet. Can't fetch data.");
      return;
    }
    try {
      setSubfolderData((prev) => ({
        ...prev,
        [folder.id]: { ...prev[folder.id], loading: true },
      }));
      const files = await fetchFolderRecursively(folder.id, 0, 10);
      setSubfolderData((prev) => ({
        ...prev,
        [folder.id]: { files, loading: false, loaded: true },
      }));
      await AsyncStorage.setItem(
        `@cachedSubfolder_${folder.id}`,
        JSON.stringify(files)
      );
    } catch (error) {
      console.error("Error fetching subfolder:", error);
      setSubfolderData((prev) => ({
        ...prev,
        [folder.id]: { ...prev[folder.id], loading: false },
      }));
    }
  };

  // Load cached subfolder if offline
  const loadCachedSubfolder = async (folder) => {
    try {
      const cached = await AsyncStorage.getItem(
        `@cachedSubfolder_${folder.id}`
      );
      if (cached) {
        const files = JSON.parse(cached);
        setSubfolderData((prev) => ({
          ...prev,
          [folder.id]: { files, loading: false, loaded: true },
        }));
      } else {
        Alert.alert("Offline", "No cached data for this folder.");
      }
    } catch (err) {
      console.error("Error loading cached subfolder:", err);
    }
  };

  // Toggle folder
  const handleToggleFolder = async (folder) => {
    if (expandedFolder === folder.id) {
      setExpandedFolder(null);
      return;
    }
    setExpandedFolder(folder.id);
    const currentData = subfolderData[folder.id];
    if (!currentData || !currentData.loaded) {
      if (isOnline) {
        fetchSubfolderContents(folder);
      } else {
        await loadCachedSubfolder(folder);
      }
    }
  };

  // OPEN FILE – always fetch => arrayBuffer => base64 => show pdf.js
  // (No "Downloading PDF..." overlay in web – so we skip that if web)
  const handleOpenFile = async (file) => {
    if (!isOnline) {
      Alert.alert("Offline", "Cannot view PDF offline (needs internet).");
      return;
    }
    // Web or mobile, pareho: we do fetch => base64
    // But we won't show "Downloading PDF" overlay in web
    const showOverlay = Platform.OS !== "web";
    try {
      if (showOverlay) setIsDownloading(true);
      const response = await fetch(file.url);
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
      if (showOverlay) setIsDownloading(false);
    }
  };

  // PRINT
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

  // SEARCH
  const handleSearch = () => {
    if (Platform.OS !== "web" && pdfViewerRef.current) {
      pdfViewerRef.current.postMessage("focusSearch");
    } else {
      Alert.alert("Search", "Use the browser's find (Ctrl+F) feature.");
    }
  };

  // INFO menu, HOME, QR code
  const toggleInfoMenu = () => setShowInfoMenu((prev) => !prev);
  const goToHome = () => {
    setShowInfoMenu(false);
    router.push("/home-screen");
  };

  // Filter data based on search
  const filteredData = useMemo(() => {
    return topFolders.reduce((acc, folder) => {
      const subData = subfolderData[folder.id] || {};
      const folderMatch = folder.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const filteredFiles =
        subData.files && searchQuery
          ? subData.files.filter(
              (file) =>
                file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                file.id.toLowerCase().includes(searchQuery.toLowerCase())
            )
          : subData.files || [];
      if (folderMatch || filteredFiles.length > 0 || !searchQuery) {
        acc.push({
          ...folder,
          files: filteredFiles,
          loading: subData.loading,
        });
      }
      return acc;
    }, []);
  }, [topFolders, subfolderData, searchQuery]);

  // ========== WEB PDF VIEWER (base64) ==========
  if (Platform.OS === "web" && selectedPdfBase64) {
    // Show pdf.js approach with left panel, search, etc.
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
            <TouchableOpacity
              onPress={() =>
                Alert.alert(
                  "Search",
                  "Use the browser's find (Ctrl+F) feature."
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
          <PdfViewer ref={pdfViewerRef} base64Data={selectedPdfBase64} />
        </View>
      </View>
    );
  }

  // ========== MOBILE PDF VIEWER (base64) ==========
  if (selectedPdfBase64 && Platform.OS !== "web") {
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

  // ========== MAIN FOLDER/FILE LIST UI ==========
  return (
    <View style={styles.container}>
      {/* Show "Downloading PDF" overlay ONLY on mobile */}
      {isDownloading && Platform.OS !== "web" && (
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
          keyExtractor={(item) => item.id}
          initialNumToRender={5}
          renderItem={({ item }) => {
            const isExpanded = expandedFolder === item.id;
            return (
              <FolderItem
                item={item}
                isExpanded={isExpanded}
                onToggleFolder={handleToggleFolder}
                onOpenFile={handleOpenFile}
              />
            );
          }}
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

// ------------------ STYLES ------------------
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
  infoMenuDescription: { fontSize: 12, color: "#666", marginBottom: 10 },
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
  viewerIcon: { width: 25, height: 25, tintColor: "#fff", marginHorizontal: 8 },
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
  qrHeader: { fontWeight: "bold", color: "#283593", marginBottom: 15 },
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

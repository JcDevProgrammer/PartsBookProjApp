import axios from "axios";

// Palitan ng iyong aktwal na Google API key
const API_KEY = "AIzaSyBQyrQ7B9pgfT_G6FWXmGGF3WJflROQwCU";

// Folder ID mula sa iyong shared link
const BASE_FOLDER_ID = "199DuYp35mYFnhUH4lpnIgBxZ-65Tclv_";

const BASE_URL = "https://www.googleapis.com/drive/v3";

/**
 * Fetches all items (folders + files) mula sa specified folder.
 * pageSize = 1000 para makuha lahat (hal. 207 items).
 * Sinusuportahan ang nextPageToken.
 */
export async function getDriveItems(folderId, pageToken = null) {
  try {
    const params = {
      q: `'${folderId}' in parents`,
      key: API_KEY,
      fields: "nextPageToken, files(id, name, mimeType, webContentLink)",
      pageSize: 1000,
    };
    if (pageToken) {
      params.pageToken = pageToken;
    }
    const response = await axios.get(`${BASE_URL}/files`, { params });
    return {
      files: response.data.files || [],
      nextPageToken: response.data.nextPageToken || null,
    };
  } catch (error) {
    console.error("Error fetching Google Drive items:", error);
    return { files: [], nextPageToken: null };
  }
}

/**
 * Fetches the items mula sa base folder (top-level).
 */
export async function getTopLevelItems() {
  const { files } = await getDriveItems(BASE_FOLDER_ID, null);
  return files;
}

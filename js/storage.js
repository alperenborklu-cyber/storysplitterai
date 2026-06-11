// Storage module using IndexedDB for autosave and JSZip for project packages

const DB_NAME = 'StorySplitterDB';
const DB_VERSION = 1;
const STORE_PAGES = 'pages';
const STORE_STATE = 'state';

let db = null;

// Initialize IndexedDB
export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('Database failed to open:', event);
      reject(event);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_PAGES)) {
        database.createObjectStore(STORE_PAGES, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_STATE)) {
        database.createObjectStore(STORE_STATE, { keyPath: 'key' });
      }
    };
  });
}

// Save a single page
export function savePage(page) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_PAGES], 'readwrite');
    const store = transaction.objectStore(STORE_PAGES);
    const request = store.put(page);

    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e);
  });
}

// Get all pages, sorted by index
export function getAllPages() {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_PAGES], 'readonly');
    const store = transaction.objectStore(STORE_PAGES);
    const request = store.getAll();

    request.onsuccess = () => {
      const pages = request.result || [];
      pages.sort((a, b) => a.index - b.index);
      resolve(pages);
    };
    request.onerror = (e) => reject(e);
  });
}

// Delete a page
export function deletePage(id) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_PAGES], 'readwrite');
    const store = transaction.objectStore(STORE_PAGES);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e);
  });
}

// Clear all pages
export function clearAllPages() {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_PAGES], 'readwrite');
    const store = transaction.objectStore(STORE_PAGES);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e);
  });
}

// Save active state metadata (e.g. current active page ID)
export function saveAppState(key, value) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_STATE], 'readwrite');
    const store = transaction.objectStore(STORE_STATE);
    const request = store.put({ key, value });

    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e);
  });
}

// Load active state metadata
export function getAppState(key) {
  if (!db) return Promise.resolve(null);
  return new Promise((resolve) => {
    const transaction = db.transaction([STORE_STATE], 'readonly');
    const store = transaction.objectStore(STORE_STATE);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result ? request.result.value : null);
    };
    request.onerror = () => resolve(null);
  });
}

// Helper: Convert Data URL to Blob
export function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

// Helper: Convert Blob to Data URL
export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(blob);
  });
}

// Export Project as .storysplitter ZIP file
export async function exportProject(pages, baseFileName) {
  const zip = new window.JSZip();
  const manifest = {
    version: '1.0.0',
    baseFileName,
    pages: []
  };

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const imageFileName = `images/page_${page.id}.png`;
    
    // Add page metadata to manifest
    manifest.pages.push({
      id: page.id,
      index: page.index,
      name: page.name,
      imageFile: imageFileName,
      cropBoxes: page.cropBoxes,
      settings: page.settings
    });

    // Add image blob to zip
    const blob = dataURLtoBlob(page.imageSrc);
    zip.file(imageFileName, blob);
  }

  zip.file('project.json', JSON.stringify(manifest, null, 2));

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  
  const link = document.createElement('a');
  link.download = `${baseFileName || 'storyboard'}.storysplitter`;
  link.href = url;
  link.click();
  
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Import Project from .storysplitter file
export async function importProject(file) {
  const zip = await window.JSZip.loadAsync(file);
  const manifestFile = zip.file('project.json');
  if (!manifestFile) {
    throw new Error('Invalid project file: project.json missing.');
  }

  const manifestContent = await manifestFile.async('text');
  const manifest = JSON.parse(manifestContent);

  const pages = [];
  for (let i = 0; i < manifest.pages.length; i++) {
    const pageData = manifest.pages[i];
    const imageZipFile = zip.file(pageData.imageFile);
    if (!imageZipFile) {
      throw new Error(`Missing image file in package: ${pageData.imageFile}`);
    }

    const imageBlob = await imageZipFile.async('blob');
    const imageSrc = await blobToDataURL(imageBlob);

    pages.push({
      id: pageData.id,
      index: pageData.index,
      name: pageData.name,
      imageSrc: imageSrc,
      cropBoxes: pageData.cropBoxes || [],
      settings: pageData.settings || {}
    });
  }

  // Clear existing IndexedDB pages
  await clearAllPages();

  // Save new pages to IndexedDB
  for (const page of pages) {
    await savePage(page);
  }

  return {
    pages,
    baseFileName: manifest.baseFileName || 'storyboard'
  };
}

// Export a page layout as a lightweight JSON coordinates file
export function exportJSONLayout(page) {
  const data = {
    appName: 'StorySplitter',
    version: '1.0.0',
    pageName: page.name,
    cropBoxes: page.cropBoxes
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `${page.name.replace(/\s+/g, '_')}_layout.json`;
  link.href = url;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Import a lightweight JSON coordinates layout
export function importJSONLayout(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.appName !== 'StorySplitter') {
          reject(new Error('Invalid layout file.'));
          return;
        }
        resolve(data.cropBoxes || []);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsText(file);
  });
}

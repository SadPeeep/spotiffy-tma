const DB_NAME = 'SpotiffyTMA';
const DB_VERSION = 1;
const STORE_NAME = 'tracks';
let db = null;

async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'track_id' });
      }
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onerror  = (e) => reject(e.target.error);
  });
}

export async function saveTrackOffline(trackId, audioBlob, coverBlob, metadata) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ track_id: trackId, audio: audioBlob, cover: coverBlob, metadata, saved_at: Date.now() }).onsuccess = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getOfflineTrack(trackId) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(trackId);
    req.onsuccess = (e) => resolve(e.target.result || null);
    req.onerror  = (e) => reject(e.target.error);
  });
}

export async function isTrackOffline(trackId) {
  return (await getOfflineTrack(trackId)) !== null;
}

export async function getAllOfflineTracks() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const req = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result || []);
    req.onerror  = (e) => reject(e.target.error);
  });
}

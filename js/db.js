// db.js — armazenamento local (IndexedDB) do PDF atual.
// As duas janelas (controle e apresentação) são do mesmo site (mesma origem),
// então ambas conseguem ler o mesmo banco local, sem precisar reenviar o
// arquivo inteiro pela rede ou pelo BroadcastChannel.

const DB_NAME = 'pdf-dual-screen-db';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const PDF_KEY = 'current-pdf';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePdfBuffer(arrayBuffer, fileName) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ data: arrayBuffer, name: fileName || 'documento.pdf' }, PDF_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadPdfBuffer() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(PDF_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

window.PdfDB = { savePdfBuffer, loadPdfBuffer };

/**
 * Font Storage Service
 * Persists custom fonts in IndexedDB so they survive page reloads
 */

const DB_NAME = 'layerforge-fonts';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

interface StoredFont {
    name: string;
    data: string; // base64 data URL
    createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'name' });
            }
        };
    });

    return dbPromise;
}

/**
 * Save a font to IndexedDB
 */
export async function saveFont(name: string, data: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const font: StoredFont = { name, data, createdAt: Date.now() };

        const request = store.put(font);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

/**
 * Get all stored fonts
 */
export async function getAllFonts(): Promise<StoredFont[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

/**
 * Delete a font from storage
 */
export async function deleteFont(name: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(name);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

/**
 * Load a font into the browser using FontFace API
 */
export async function loadFontIntoDocument(name: string, data: string): Promise<void> {
    try {
        const font = new FontFace(name, `url(${data})`);
        await font.load();
        (document.fonts as any).add(font);
    } catch (error) {
        console.error(`Failed to load font ${name}:`, error);
        throw error;
    }
}

/**
 * Load all stored fonts into the document on app startup
 */
export async function loadAllStoredFonts(): Promise<string[]> {
    const fonts = await getAllFonts();
    const loadedFonts: string[] = [];

    for (const font of fonts) {
        try {
            await loadFontIntoDocument(font.name, font.data);
            loadedFonts.push(font.name);
        } catch (error) {
            console.error(`Failed to load stored font ${font.name}:`, error);
        }
    }

    return loadedFonts;
}

// The saved game in the browser (src/flow/snapshot.ts): one save, kept in IndexedDB (about 3 MB:
// the RAM and VRAM; too big for localStorage). Saving also asks the browser to keep the site's
// storage (the save and the memory card) instead of clearing it when space runs low.
import { isSnapshot, type Snapshot } from '../flow/snapshot';

const DB = 'tetris-plus';
const STORE = 'saves';
const KEY = 'game';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
    });
  } finally {
    db.close();
  }
}

/** The saved game, if there is one this version can resume. */
export async function loadSave(): Promise<Snapshot | undefined> {
  const s = await run('readonly', (store) => store.get(KEY));
  return isSnapshot(s) ? s : undefined;
}

/** Keeps `s` as the saved game, in place of the last one. */
export async function storeSave(s: Snapshot): Promise<void> {
  await run('readwrite', (store) => store.put(s, KEY));
  void navigator.storage?.persist?.().catch(() => false);
}

export async function deleteSave(): Promise<void> {
  await run('readwrite', (store) => store.delete(KEY));
}

/** When a save was made, e.g. "Oct 23, 2:05 PM". */
export function savedWhen(s: Snapshot): string {
  return new Date(s.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

import type { StoredCouncilSession } from "./types";

const DB_NAME = "ai-council";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

export async function saveSession(session: StoredCouncilSession): Promise<StoredCouncilSession> {
  const db = await openDatabase();
  const key = await requestToPromise(
    db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).add(session)
  );

  db.close();
  return { ...session, id: Number(key) };
}

export async function listSessions(): Promise<StoredCouncilSession[]> {
  const db = await openDatabase();
  const sessions = await requestToPromise<StoredCouncilSession[]>(
    db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll()
  );

  db.close();
  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}

export async function clearSessions(): Promise<void> {
  const db = await openDatabase();

  await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).clear());
  db.close();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true
        });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T = undefined>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

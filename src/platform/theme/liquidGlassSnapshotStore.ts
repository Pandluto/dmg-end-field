const DATABASE_NAME = 'dmg-liquid-glass-snapshots';
const DATABASE_VERSION = 1;
const SNAPSHOT_STORE = 'snapshots';
const METADATA_STORE = 'metadata';
const MAX_PERSISTED_ENTRIES = 96;
const MAX_PERSISTED_BYTES = 192 * 1024 * 1024;

type SnapshotNamespace = 'skill' | 'surface';

type PersistedCanvas = {
  blob: Blob;
  cssText: string;
  height: number;
  width: number;
};

type PersistedSnapshot = {
  canvases: PersistedCanvas[];
  key: string;
};

type PersistedMetadata = {
  byteSize: number;
  key: string;
  updatedAt: number;
};

export type HydratedGlassSnapshot = {
  byteSize: number;
  canvases: Array<{
    canvas: HTMLCanvasElement;
    cssText: string;
  }>;
};

let databasePromise: Promise<IDBDatabase | null> | null = null;
const pendingWrites = new Map<string, Promise<void>>();

function namespacedKey(namespace: SnapshotNamespace, key: string): string {
  return `${namespace}:${key}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  databasePromise = new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        const metadata = database.createObjectStore(METADATA_STORE, { keyPath: 'key' });
        metadata.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return databasePromise;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/png');
    } catch {
      resolve(null);
    }
  });
}

async function blobToCanvas(entry: PersistedCanvas): Promise<HTMLCanvasElement | null> {
  if (entry.width <= 0 || entry.height <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = entry.width;
  canvas.height = entry.height;
  canvas.style.cssText = entry.cssText;
  const context = canvas.getContext('2d');
  if (!context) return null;

  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(entry.blob);
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return canvas;
    }

    const objectUrl = URL.createObjectURL(entry.blob);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      context.drawImage(image, 0, 0);
      return canvas;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }
}

async function prunePersistentSnapshots(database: IDBDatabase): Promise<void> {
  const metadataTransaction = database.transaction(METADATA_STORE, 'readonly');
  const metadataTransactionComplete = transactionComplete(metadataTransaction);
  const metadata = await requestResult(
    metadataTransaction.objectStore(METADATA_STORE).getAll() as IDBRequest<PersistedMetadata[]>,
  );
  await metadataTransactionComplete;

  const ordered = metadata.sort((left, right) => left.updatedAt - right.updatedAt);
  let totalBytes = ordered.reduce((total, entry) => total + entry.byteSize, 0);
  const keysToDelete: string[] = [];
  while (
    ordered.length - keysToDelete.length > MAX_PERSISTED_ENTRIES
    || totalBytes > MAX_PERSISTED_BYTES
  ) {
    const oldest = ordered[keysToDelete.length];
    if (!oldest) break;
    keysToDelete.push(oldest.key);
    totalBytes -= oldest.byteSize;
  }
  if (keysToDelete.length === 0) return;

  const deleteTransaction = database.transaction([SNAPSHOT_STORE, METADATA_STORE], 'readwrite');
  const snapshots = deleteTransaction.objectStore(SNAPSHOT_STORE);
  const metadataStore = deleteTransaction.objectStore(METADATA_STORE);
  keysToDelete.forEach((key) => {
    snapshots.delete(key);
    metadataStore.delete(key);
  });
  await transactionComplete(deleteTransaction);
}

export async function readPersistentGlassSnapshot(
  namespace: SnapshotNamespace,
  key: string,
  expectedCanvasCount?: number,
): Promise<HydratedGlassSnapshot | null> {
  try {
    const database = await openDatabase();
    if (!database) return null;
    const cacheKey = namespacedKey(namespace, key);
    const transaction = database.transaction(SNAPSHOT_STORE, 'readonly');
    const readComplete = transactionComplete(transaction);
    const record = await requestResult(
      transaction.objectStore(SNAPSHOT_STORE).get(cacheKey) as IDBRequest<PersistedSnapshot | undefined>,
    );
    await readComplete;
    if (
      !record
      || (
        typeof expectedCanvasCount === 'number'
        && record.canvases.length !== expectedCanvasCount
      )
    ) return null;

    const hydrated = await Promise.all(record.canvases.map(blobToCanvas));
    if (hydrated.some((canvas) => canvas === null)) {
      hydrated.forEach((canvas) => {
        if (!canvas) return;
        canvas.width = 0;
        canvas.height = 0;
      });
      return null;
    }

    const touchTransaction = database.transaction(METADATA_STORE, 'readwrite');
    const metadataStore = touchTransaction.objectStore(METADATA_STORE);
    metadataStore.put({
      byteSize: record.canvases.reduce((total, entry) => total + entry.blob.size, 0),
      key: cacheKey,
      updatedAt: Date.now(),
    } satisfies PersistedMetadata);
    void transactionComplete(touchTransaction).catch(() => undefined);

    const canvases = hydrated as HTMLCanvasElement[];
    return {
      byteSize: canvases.reduce((total, canvas) => total + canvas.width * canvas.height * 4, 0),
      canvases: canvases.map((canvas, index) => ({
        canvas,
        cssText: record.canvases[index]?.cssText ?? '',
      })),
    };
  } catch {
    return null;
  }
}

export async function prewarmRecentPersistentGlassSnapshots(
  namespace: SnapshotNamespace,
  maxEntries: number,
  acceptsKey: (key: string) => boolean,
  onSnapshot: (key: string, snapshot: HydratedGlassSnapshot) => void,
): Promise<void> {
  try {
    const database = await openDatabase();
    if (!database || maxEntries <= 0) return;
    const namespacePrefix = `${namespace}:`;
    const transaction = database.transaction(METADATA_STORE, 'readonly');
    const readComplete = transactionComplete(transaction);
    const metadata = await requestResult(
      transaction.objectStore(METADATA_STORE).getAll() as IDBRequest<PersistedMetadata[]>,
    );
    await readComplete;

    const keys = metadata
      .filter(({ key }) => key.startsWith(namespacePrefix))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(({ key }) => key.slice(namespacePrefix.length))
      .filter(acceptsKey)
      .slice(0, maxEntries);

    // Decode sequentially so startup never creates a large transient bitmap
    // spike. Each decoded entry becomes immediately available to the hooks.
    for (const key of keys) {
      const snapshot = await readPersistentGlassSnapshot(namespace, key);
      if (snapshot) onSnapshot(key, snapshot);
    }
  } catch {
    // Prewarming is opportunistic; exact-key reads remain available on demand.
  }
}

export function persistGlassSnapshot(
  namespace: SnapshotNamespace,
  key: string,
  canvases: readonly { canvas: HTMLCanvasElement; cssText: string }[],
): void {
  const cacheKey = namespacedKey(namespace, key);
  if (pendingWrites.has(cacheKey)) return;

  const write = (async () => {
    try {
      const blobs = await Promise.all(canvases.map(({ canvas }) => canvasToBlob(canvas)));
      if (blobs.some((blob) => blob === null)) return;
      const database = await openDatabase();
      if (!database) return;

      const persistedCanvases = canvases.map(({ canvas, cssText }, index) => ({
        blob: blobs[index] as Blob,
        cssText,
        height: canvas.height,
        width: canvas.width,
      }));
      const byteSize = persistedCanvases.reduce((total, entry) => total + entry.blob.size, 0);
      const transaction = database.transaction([SNAPSHOT_STORE, METADATA_STORE], 'readwrite');
      transaction.objectStore(SNAPSHOT_STORE).put({
        canvases: persistedCanvases,
        key: cacheKey,
      } satisfies PersistedSnapshot);
      transaction.objectStore(METADATA_STORE).put({
        byteSize,
        key: cacheKey,
        updatedAt: Date.now(),
      } satisfies PersistedMetadata);
      await transactionComplete(transaction);
      await prunePersistentSnapshots(database);
    } catch {
      // Persistent caching is an acceleration only; memory caching remains valid.
    }
  })().finally(() => {
    pendingWrites.delete(cacheKey);
  });

  pendingWrites.set(cacheKey, write);
}

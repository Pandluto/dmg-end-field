import { webDatabase } from '../database/webDatabase';

type StorageScope = 'local' | 'workspace';

class SqliteBackedStorage {
  private readonly values = new Map<string, string>();
  private readonly pending = new Map<string, string | null>();
  private readonly listeners = new Set<(keys: readonly string[]) => void>();
  private hydrated = false;
  private flushTimer: number | null = null;
  private flushChain = Promise.resolve();

  constructor(private readonly scope: StorageScope) {}

  async hydrate(): Promise<void> {
    const rows = await webDatabase.query<{ key: string; value: string | null }>(
      'SELECT key, value FROM kv_store WHERE scope = ? AND value IS NOT NULL',
      [this.scope],
    );
    this.values.clear();
    for (const row of rows) {
      if (typeof row.key === 'string' && typeof row.value === 'string') {
        this.values.set(row.key, row.value);
      }
    }
    this.hydrated = true;
  }

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(String(key)) ?? null;
  }

  setItem(key: string, value: string): void {
    const normalizedKey = String(key);
    const normalizedValue = String(value);
    this.values.set(normalizedKey, normalizedValue);
    this.pending.set(normalizedKey, normalizedValue);
    this.scheduleFlush();
    this.notify([normalizedKey]);
  }

  removeItem(key: string): void {
    const normalizedKey = String(key);
    this.values.delete(normalizedKey);
    this.pending.set(normalizedKey, null);
    this.scheduleFlush();
    this.notify([normalizedKey]);
  }

  clear(): void {
    const keys = [...this.values.keys()];
    for (const key of keys) this.pending.set(key, null);
    this.values.clear();
    this.scheduleFlush();
    this.notify(keys);
  }

  entries(): Array<[string, string]> {
    return [...this.values.entries()];
  }

  isHydrated(): boolean {
    return this.hydrated;
  }

  subscribe(listener: (keys: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.size === 0) {
      await this.flushChain;
      return;
    }
    const updates = [...this.pending.entries()];
    this.pending.clear();
    const now = Date.now();
    this.flushChain = this.flushChain
      .catch(() => undefined)
      .then(() => webDatabase.batch(updates.map(([key, value]) => ({
        sql: `
          INSERT INTO kv_store(scope, key, value, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(scope, key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `,
        bind: [this.scope, key, value, now],
      }))))
      .then(() => undefined);
    await this.flushChain;
  }

  private scheduleFlush(): void {
    if (!this.hydrated || typeof window === 'undefined') return;
    if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch((error) => {
        console.error(`[persistentStorage:${this.scope}] write failed`, error);
      });
    }, 60);
  }

  private notify(keys: readonly string[]): void {
    if (!keys.length) return;
    for (const listener of this.listeners) {
      try {
        listener(keys);
      } catch {
        // Storage writes must not fail because an optional observer failed.
      }
    }
  }
}

export const persistentLocalStorage = new SqliteBackedStorage('local');
export const persistentWorkspaceStorage = new SqliteBackedStorage('workspace');

export async function bootstrapPersistentStorage(): Promise<void> {
  await Promise.all([
    persistentLocalStorage.hydrate(),
    persistentWorkspaceStorage.hydrate(),
  ]);
}

export async function flushPersistentStorage(): Promise<void> {
  await Promise.all([
    persistentLocalStorage.flush(),
    persistentWorkspaceStorage.flush(),
  ]);
}

import { webDatabase } from '../database/webDatabase';

type StorageScope = 'local' | 'workspace';

class SqliteBackedStorage {
  private readonly values = new Map<string, string>();
  private readonly pending = new Map<string, string | null>();
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
  }

  removeItem(key: string): void {
    const normalizedKey = String(key);
    this.values.delete(normalizedKey);
    this.pending.set(normalizedKey, null);
    this.scheduleFlush();
  }

  clear(): void {
    for (const key of this.values.keys()) this.pending.set(key, null);
    this.values.clear();
    this.scheduleFlush();
  }

  entries(): Array<[string, string]> {
    return [...this.values.entries()];
  }

  isHydrated(): boolean {
    return this.hydrated;
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


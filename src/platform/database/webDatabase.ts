export type SqlPrimitive = string | number | bigint | null | Uint8Array | ArrayBuffer;

export type SqlStatement = {
  sql: string;
  bind?: SqlPrimitive[];
};

export type WebDatabaseInfo = {
  sqliteVersion: string;
  filename: string;
  vfs: string;
  persistent: boolean;
};

type DatabaseResponse = {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { message?: string; stack?: string };
};

class WebDatabase {
  private worker: Worker | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>();
  private info: WebDatabaseInfo | null = null;

  async initialize(): Promise<WebDatabaseInfo> {
    if (this.info) return this.info;
    this.ensureWorker();
    this.info = await this.request<WebDatabaseInfo>('initialize');
    return this.info;
  }

  getInfo(): WebDatabaseInfo | null {
    return this.info;
  }

  async query<T extends Record<string, SqlPrimitive>>(sql: string, bind: SqlPrimitive[] = []): Promise<T[]> {
    await this.initialize();
    return this.request<T[]>('query', { statement: { sql, bind } });
  }

  async execute(sql: string, bind: SqlPrimitive[] = []): Promise<{ changes: number }> {
    await this.initialize();
    return this.request<{ changes: number }>('execute', { statement: { sql, bind } });
  }

  async batch(statements: SqlStatement[]): Promise<{ changes: number }> {
    await this.initialize();
    return this.request<{ changes: number }>('batch', { statements });
  }

  async exportFile(): Promise<Uint8Array> {
    await this.initialize();
    return this.request<Uint8Array>('export');
  }

  async close(): Promise<void> {
    if (!this.worker) return;
    try {
      await this.request('close');
    } finally {
      this.worker.terminate();
      this.worker = null;
      this.info = null;
      for (const pending of this.pending.values()) {
        pending.reject(new Error('Web database worker was closed.'));
      }
      this.pending.clear();
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./webDatabase.worker.ts', import.meta.url), {
      type: 'module',
      name: 'dmg-web-database',
    });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
    return this.worker;
  }

  private readonly handleMessage = (event: MessageEvent<DatabaseResponse>) => {
    const response = event.data;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
      return;
    }
    const error = new Error(response.error?.message || 'Web database request failed.');
    if (response.error?.stack) error.stack = response.error.stack;
    pending.reject(error);
  };

  private readonly handleWorkerError = (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  };

  private request<T>(
    operation: 'initialize' | 'query' | 'execute' | 'batch' | 'export' | 'close',
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      worker.postMessage({ id, operation, ...payload });
    });
  }
}

export const webDatabase = new WebDatabase();

export async function requestPersistentBrowserStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

export async function readBrowserStorageEstimate(): Promise<{
  usage: number;
  quota: number;
  persisted: boolean;
}> {
  const estimate = await navigator.storage?.estimate?.();
  const persisted = await navigator.storage?.persisted?.();
  return {
    usage: Number(estimate?.usage || 0),
    quota: Number(estimate?.quota || 0),
    persisted: Boolean(persisted),
  };
}


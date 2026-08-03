export interface WebImageObjectUrlEntry {
  relativePath: string;
  mimeType: string;
  content: Uint8Array;
}

export interface WebImageObjectUrlRuntime {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

interface RegisteredObjectUrl {
  contentSignature: string;
  url: string;
}

function fingerprintContent(content: Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < content.length; index += 1) {
    const byte = content[index];
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ (byte + index), 0x85ebca6b);
  }
  return `${content.byteLength}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

export function createWebImageObjectUrlRegistry(
  runtime: WebImageObjectUrlRuntime = URL,
) {
  const registeredByPath = new Map<string, RegisteredObjectUrl>();

  const synchronize = (entries: WebImageObjectUrlEntry[]): boolean => {
    let changed = false;
    const presentPaths = new Set<string>();
    for (const entry of entries) {
      if (!entry.relativePath) continue;
      presentPaths.add(entry.relativePath);
      const contentSignature = `${entry.mimeType}\0${fingerprintContent(entry.content)}`;
      const current = registeredByPath.get(entry.relativePath);
      if (current?.contentSignature === contentSignature) {
        continue;
      }

      const bytes = new Uint8Array(entry.content);
      const url = runtime.createObjectURL(new Blob([bytes], {
        type: entry.mimeType || 'application/octet-stream',
      }));
      registeredByPath.set(entry.relativePath, { contentSignature, url });
      changed = true;
      if (current) {
        runtime.revokeObjectURL(current.url);
      }
    }

    for (const [relativePath, current] of registeredByPath) {
      if (presentPaths.has(relativePath)) continue;
      runtime.revokeObjectURL(current.url);
      registeredByPath.delete(relativePath);
      changed = true;
    }
    return changed;
  };

  return {
    get(relativePath: string): string | null {
      return registeredByPath.get(relativePath)?.url ?? null;
    },
    synchronize,
  };
}

export type WebImageObjectUrlRegistry = ReturnType<typeof createWebImageObjectUrlRegistry>;

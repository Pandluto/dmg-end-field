import fs from 'node:fs';
import path from 'node:path';

const CONTRACT = 'DefGuideLoadoutSourceStoreV1';

function safeString(value, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && normalized.length <= maxLength ? normalized : '';
}

export function createDefGuideSourceStore(options = {}) {
  const filePath = path.resolve(String(options.filePath || ''));
  const ttlMs = Number(options.ttlMs);
  const maxEntries = Number(options.maxEntries || 100);
  const maxContentChars = Number(options.maxContentChars || 12000);
  const hash = options.hash;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  if (!options.filePath || !Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isInteger(maxEntries) || maxEntries <= 0 || typeof hash !== 'function') {
    throw new TypeError('Invalid DEF guide source store options');
  }

  let hydrated = false;

  function normalize(source, currentTime = now()) {
    const sessionId = safeString(source?.sessionId, 240);
    const referenceId = safeString(source?.referenceId, 512);
    const sectionId = safeString(source?.sectionId, 512);
    const content = typeof source?.content === 'string' && source.content.length <= maxContentChars ? source.content : '';
    const rememberedAt = Number(source?.rememberedAt);
    const expiresAt = Number(source?.expiresAt);
    if (!sessionId || !referenceId || !sectionId || !content
      || !Number.isFinite(rememberedAt) || !Number.isFinite(expiresAt)
      || expiresAt <= currentTime || expiresAt > rememberedAt + ttlMs) return null;
    return { sessionId, referenceId, sectionId, content, sourceContentHash: hash(content), rememberedAt, expiresAt };
  }

  function serializableSources(target, currentTime = now()) {
    return [...target.values()]
      .map((source) => normalize(source, currentTime))
      .filter(Boolean)
      .sort((left, right) => right.rememberedAt - left.rememberedAt)
      .slice(0, maxEntries);
  }

  function persist(target, currentTime = now()) {
    const sources = serializableSources(target, currentTime);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify({ contract: CONTRACT, sources }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  }

  function hydrate(target) {
    if (hydrated) return;
    hydrated = true;
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return;
    }
    if (parsed?.contract !== CONTRACT || !Array.isArray(parsed.sources)) return;
    const currentTime = now();
    const sources = parsed.sources
      .map((source) => normalize(source, currentTime))
      .filter(Boolean)
      .sort((left, right) => right.rememberedAt - left.rememberedAt)
      .slice(0, maxEntries);
    for (const source of sources.reverse()) target.set(source.sessionId, source);
    if (sources.length !== parsed.sources.length) persist(target, currentTime);
  }

  function prune(target) {
    hydrate(target);
    const currentTime = now();
    let changed = false;
    for (const [sessionId, source] of target) {
      if (!normalize(source, currentTime)) {
        target.delete(sessionId);
        changed = true;
      }
    }
    if (target.size > maxEntries) {
      const keep = new Set(serializableSources(target, currentTime).map((source) => source.sessionId));
      for (const sessionId of target.keys()) {
        if (!keep.has(sessionId)) {
          target.delete(sessionId);
          changed = true;
        }
      }
    }
    if (changed) persist(target, currentTime);
  }

  function remember(target, input) {
    hydrate(target);
    const currentTime = now();
    const source = normalize({
      ...input,
      rememberedAt: currentTime,
      expiresAt: currentTime + ttlMs,
    }, currentTime - 1);
    if (!source) throw new TypeError('Invalid DEF guide source');
    target.set(source.sessionId, source);
    prune(target);
    persist(target, currentTime);
    return source;
  }

  return Object.freeze({ hydrate, prune, remember });
}

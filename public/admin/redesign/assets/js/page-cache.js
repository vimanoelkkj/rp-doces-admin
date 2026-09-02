const DEFAULT_TTL = 30_000;
const PERSISTED_KEYS = new Set(["dashboard"]);
const STORAGE_PREFIX = "rp-admin-page-cache:";
const MAX_PERSISTED_AGE = 6 * 60 * 60 * 1000;

const entries = new Map();

function storageKey(key) {
  return `${STORAGE_PREFIX}${key}`;
}

function readPersisted(key) {
  if (!PERSISTED_KEYS.has(key)) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.updatedAt !== "number" || !entry.data) return null;
    if (Date.now() - entry.updatedAt > MAX_PERSISTED_AGE) {
      window.localStorage.removeItem(storageKey(key));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writePersisted(key, entry) {
  if (!PERSISTED_KEYS.has(key)) return;
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // Cache persistente é apenas uma otimização; falhas de quota não bloqueiam a interface.
  }
}

function removePersisted(key) {
  if (!PERSISTED_KEYS.has(key)) return;
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    // Ignora indisponibilidade do storage.
  }
}

export function getCachedPage(key) {
  let entry = entries.get(key);

  if (!entry) {
    entry = readPersisted(key);
    if (entry) entries.set(key, entry);
  }

  if (!entry) {
    return {
      data: null,
      hasData: false,
      fresh: false,
      age: Infinity
    };
  }

  const age = Date.now() - entry.updatedAt;

  return {
    data: entry.data,
    hasData: true,
    fresh: age < entry.ttl,
    age
  };
}

export function setCachedPage(key, data, ttl = DEFAULT_TTL) {
  const entry = {
    data,
    ttl,
    updatedAt: Date.now()
  };
  entries.set(key, entry);
  writePersisted(key, entry);

  return data;
}

export function invalidatePageCache(...keys) {
  keys.flat().forEach(key => {
    entries.delete(key);
    removePersisted(key);
  });
}

export function clearPageCache() {
  entries.clear();
  PERSISTED_KEYS.forEach(removePersisted);
}

export async function loadCachedPage(
  key,
  loader,
  { ttl = DEFAULT_TTL, force = false } = {}
) {
  const cached = getCachedPage(key);

  if (!force && cached.fresh) {
    return {
      data: cached.data,
      source: "cache",
      stale: false
    };
  }

  const data = await loader();
  setCachedPage(key, data, ttl);

  return {
    data,
    source: "network",
    stale: false
  };
}

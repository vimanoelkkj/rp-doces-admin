const DEFAULT_TTL = 30_000;

const entries = new Map();

export function getCachedPage(key) {
  const entry = entries.get(key);

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
  entries.set(key, {
    data,
    ttl,
    updatedAt: Date.now()
  });

  return data;
}

export function invalidatePageCache(...keys) {
  keys.flat().forEach(key => entries.delete(key));
}

export function clearPageCache() {
  entries.clear();
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

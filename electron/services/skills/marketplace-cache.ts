// Lazy-load electron-store (ESM module) from the main process only.

interface MarketplaceCacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
  updatedAt: number;
  accessedAt: number;
  sourceId?: string;
}

interface MarketplaceCacheState {
  schemaVersion: 1;
  entries: Record<string, MarketplaceCacheEntry>;
}

const MARKETPLACE_CACHE_SCHEMA_VERSION = 1;
const MARKETPLACE_CACHE_MAX_ENTRIES = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let marketplaceCacheStore: any = null;

async function getMarketplaceCacheStore() {
  if (!marketplaceCacheStore) {
    const Store = (await import('electron-store')).default;
    marketplaceCacheStore = new Store<MarketplaceCacheState>({
      name: 'clawhub-marketplace-cache',
      defaults: {
        schemaVersion: MARKETPLACE_CACHE_SCHEMA_VERSION,
        entries: {},
      },
    });
  }

  const schemaVersion = marketplaceCacheStore.get('schemaVersion');
  if (schemaVersion !== MARKETPLACE_CACHE_SCHEMA_VERSION) {
    marketplaceCacheStore.clear();
    marketplaceCacheStore.set('schemaVersion', MARKETPLACE_CACHE_SCHEMA_VERSION);
    marketplaceCacheStore.set('entries', {});
  }

  return marketplaceCacheStore;
}

function pruneEntries(
  entries: Record<string, MarketplaceCacheEntry>,
  now: number,
): Record<string, MarketplaceCacheEntry> {
  const nextEntries = Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => entry && entry.expiresAt > now),
  ) as Record<string, MarketplaceCacheEntry>;

  const keys = Object.keys(nextEntries);
  if (keys.length <= MARKETPLACE_CACHE_MAX_ENTRIES) {
    return nextEntries;
  }

  const keysByRecency = keys.sort((left, right) => {
    const leftEntry = nextEntries[left];
    const rightEntry = nextEntries[right];
    return (rightEntry?.accessedAt ?? 0) - (leftEntry?.accessedAt ?? 0);
  });

  const keep = new Set(keysByRecency.slice(0, MARKETPLACE_CACHE_MAX_ENTRIES));
  return Object.fromEntries(
    Object.entries(nextEntries).filter(([key]) => keep.has(key)),
  ) as Record<string, MarketplaceCacheEntry>;
}

async function writeEntries(entries: Record<string, MarketplaceCacheEntry>): Promise<void> {
  const store = await getMarketplaceCacheStore();
  store.set('entries', entries);
}

async function readEntries(): Promise<Record<string, MarketplaceCacheEntry>> {
  const store = await getMarketplaceCacheStore();
  return (store.get('entries') ?? {}) as Record<string, MarketplaceCacheEntry>;
}

export async function readMarketplaceCache<T>(key: string): Promise<T | null> {
  const now = Date.now();
  const entries = await readEntries();
  const entry = entries[key];
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= now) {
    delete entries[key];
    await writeEntries(entries);
    return null;
  }

  entry.accessedAt = now;
  entries[key] = entry;
  await writeEntries(entries);
  return entry.value as T;
}

export async function writeMarketplaceCache<T>(
  key: string,
  value: T,
  options: {
    ttlMs: number;
    sourceId?: string;
  },
): Promise<void> {
  const now = Date.now();
  const entries = await readEntries();
  entries[key] = {
    value,
    expiresAt: now + Math.max(1, Math.trunc(options.ttlMs)),
    updatedAt: now,
    accessedAt: now,
    ...(options.sourceId ? { sourceId: options.sourceId } : {}),
  };
  await writeEntries(pruneEntries(entries, now));
}

export async function invalidateMarketplaceCacheKey(key: string): Promise<void> {
  const entries = await readEntries();
  if (!Object.prototype.hasOwnProperty.call(entries, key)) {
    return;
  }
  delete entries[key];
  await writeEntries(entries);
}

export async function invalidateMarketplaceCacheForSource(sourceId: string): Promise<void> {
  const entries = await readEntries();
  const nextEntries = Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => entry?.sourceId !== sourceId),
  ) as Record<string, MarketplaceCacheEntry>;
  if (Object.keys(nextEntries).length === Object.keys(entries).length) {
    return;
  }
  await writeEntries(nextEntries);
}

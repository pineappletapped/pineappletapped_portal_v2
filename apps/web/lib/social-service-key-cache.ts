import 'server-only';

const CACHE_KEY = '__ptfbSocialServiceKeyCache__';

type CacheStore = {
  [CACHE_KEY]?: string | null | undefined;
};

const globalStore = globalThis as typeof globalThis & CacheStore;

export function getCachedSocialServiceKey(): string | null | undefined {
  return globalStore[CACHE_KEY];
}

export function setCachedSocialServiceKey(value: string | null | undefined): void {
  globalStore[CACHE_KEY] = value;
}

export function resetCachedSocialServiceKey(): void {
  globalStore[CACHE_KEY] = undefined;
}

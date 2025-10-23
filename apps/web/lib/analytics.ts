import { ensureFirebase } from './firebase';
import { resolveHttpFunctionUrl } from './httpFunctions';

const STORAGE_KEY = 'portal_analytics_queue_v1';
const VISITOR_KEY = 'analytics_uid';
const MAX_QUEUE_LENGTH = 200;
const MAX_BATCH_SIZE = 10;
const BASE_FLUSH_INTERVAL_MS = 5000;
const MAX_FLUSH_INTERVAL_MS = 60000;
const ERROR_LOG_INTERVAL_MS = 60_000;

const ANALYTICS_FALLBACK_ENDPOINTS = [
  'https://europe-west2-pineapple-tapped---portal.cloudfunctions.net/analytics_track',
  'https://us-central1-pineapple-tapped---portal.cloudfunctions.net/analytics_track',
];

type AnalyticsQueueEvent = {
  id: string;
  path: string;
  referrer: string | null;
  durationMs: number | null;
  startedAtMs: number | null;
  visitorId: string | null;
  userAgent: string | null;
  language: string | null;
  screen: string | null;
  createdAtMs: number;
};

type FlushResult = 'success' | 'retry';

type PostBatchResult =
  | { kind: 'success' }
  | { kind: 'auth-error' }
  | { kind: 'endpoint-missing' }
  | { kind: 'invalid-request'; message: string }
  | { kind: 'retryable'; message: string };

let analyticsClient: AnalyticsClient | null = null;

const getNow = () => Date.now();

const safeLocalStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const storage = window.localStorage;
    storage.getItem('__test__');
    return storage;
  } catch {
    return null;
  }
};

const createVisitorId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${getNow()}-${Math.random().toString(16).slice(2)}`;
};

let cachedVisitorId: string | null = null;

function getVisitorId(): string | null {
  if (cachedVisitorId) {
    return cachedVisitorId;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  const storage = safeLocalStorage();
  if (!storage) {
    return null;
  }
  try {
    const existing = storage.getItem(VISITOR_KEY);
    if (existing && existing !== 'undefined') {
      cachedVisitorId = existing;
      return existing;
    }
    const generated = createVisitorId();
    storage.setItem(VISITOR_KEY, generated);
    cachedVisitorId = generated;
    return generated;
  } catch {
    return null;
  }
}

function resolveAnalyticsEndpoints(): string[] {
  const endpoints: string[] = [];
  try {
    const primary = resolveHttpFunctionUrl('analytics_track', { allowRelativeFallback: false });
    if (primary) {
      endpoints.push(primary);
    }
  } catch (error) {
    console.warn('Analytics tracker could not determine primary endpoint', error);
  }

  ANALYTICS_FALLBACK_ENDPOINTS.forEach((endpoint) => {
    if (!endpoints.includes(endpoint)) {
      endpoints.push(endpoint);
    }
  });

  return endpoints;
}

async function getIdToken(forceRefresh = false): Promise<string | null> {
  try {
    const { auth } = await ensureFirebase();
    if (!auth || (auth as any).__isPlaceholder) {
      return null;
    }
    const user = auth.currentUser;
    if (!user) {
      return null;
    }
    return await user.getIdToken(forceRefresh);
  } catch (error) {
    console.warn('Analytics tracker failed to resolve auth token', error);
    return null;
  }
}

class AnalyticsClient {
  private queue: AnalyticsQueueEvent[] = [];

  private flushTimer: number | null = null;

  private flushing = false;

  private consecutiveFailures = 0;

  private lastErrorLogAt = 0;

  private initialized = false;

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }
    this.queue = this.loadQueue();
    this.initialized = true;
  }

  enqueue(event: AnalyticsQueueEvent) {
    if (!this.initialized) {
      return;
    }
    this.queue.push(event);
    if (this.queue.length > MAX_QUEUE_LENGTH) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE_LENGTH);
    }
    this.persistQueue();
    this.scheduleFlush();
  }

  scheduleFlush(delayMs?: number) {
    if (!this.initialized) {
      return;
    }
    const delay = delayMs ?? BASE_FLUSH_INTERVAL_MS;
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  async flush(immediate = false) {
    if (!this.initialized) {
      return;
    }
    if (this.queue.length === 0) {
      return;
    }
    if (this.flushing) {
      if (immediate) {
        this.scheduleFlush(1000);
      }
      return;
    }
    this.flushing = true;
    try {
      const success = await this.flushInternal();
      if (success === 'success') {
        this.consecutiveFailures = 0;
        if (this.queue.length > 0) {
          this.scheduleFlush(BASE_FLUSH_INTERVAL_MS);
        }
      } else {
        this.consecutiveFailures += 1;
        const backoff = Math.min(
          MAX_FLUSH_INTERVAL_MS,
          BASE_FLUSH_INTERVAL_MS * Math.pow(2, this.consecutiveFailures - 1),
        );
        this.scheduleFlush(backoff);
      }
    } finally {
      this.flushing = false;
    }
  }

  dispose() {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.initialized = false;
  }

  getQueueSnapshot() {
    return [...this.queue];
  }

  private loadQueue(): AnalyticsQueueEvent[] {
    const storage = safeLocalStorage();
    if (!storage) {
      return [];
    }
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as AnalyticsQueueEvent[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((item) => item && typeof item.path === 'string')
        .map((item) => ({
          ...item,
          id: item.id ?? createVisitorId(),
          referrer: item.referrer ?? null,
          durationMs: typeof item.durationMs === 'number' ? item.durationMs : null,
          startedAtMs: typeof item.startedAtMs === 'number' ? item.startedAtMs : null,
          visitorId: item.visitorId ?? null,
          userAgent: item.userAgent ?? null,
          language: item.language ?? null,
          screen: item.screen ?? null,
          createdAtMs: typeof item.createdAtMs === 'number' ? item.createdAtMs : getNow(),
        }));
    } catch (error) {
      console.warn('Analytics tracker failed to load queue', error);
      return [];
    }
  }

  private persistQueue() {
    const storage = safeLocalStorage();
    if (!storage) {
      return;
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      console.warn('Analytics tracker failed to persist queue', error);
    }
  }

  private async flushInternal(): Promise<FlushResult> {
    const endpoints = resolveAnalyticsEndpoints();
    if (endpoints.length === 0) {
      this.logError('No analytics endpoints available');
      return 'retry';
    }

    for (const endpoint of endpoints) {
      const result = await this.flushAgainstEndpoint(endpoint);
      if (result === 'success') {
        return 'success';
      }
    }

    return 'retry';
  }

  private async flushAgainstEndpoint(endpoint: string): Promise<FlushResult> {
    if (this.queue.length === 0) {
      return 'success';
    }

    let token = await getIdToken(false);
    let attemptedRefresh = false;

    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, MAX_BATCH_SIZE);
      const result = await this.postBatch(endpoint, batch, token);

      if (result.kind === 'success') {
        this.queue.splice(0, batch.length);
        this.persistQueue();
        continue;
      }

      if (result.kind === 'auth-error') {
        if (!attemptedRefresh) {
          token = await getIdToken(true);
          attemptedRefresh = true;
          continue;
        }
        this.logError('Analytics tracker authentication failed after refresh attempt');
        return 'retry';
      }

      if (result.kind === 'invalid-request') {
        this.logError(`Dropping analytics batch: ${result.message}`);
        this.queue.splice(0, batch.length);
        this.persistQueue();
        continue;
      }

      if (result.kind === 'endpoint-missing') {
        this.logError(`Analytics endpoint missing: ${endpoint}`);
        return 'retry';
      }

      this.logError(`Analytics tracker retryable error: ${result.message}`);
      return 'retry';
    }

    return 'success';
  }

  private async postBatch(
    endpoint: string,
    batch: AnalyticsQueueEvent[],
    idToken: string | null,
  ): Promise<PostBatchResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }

    const body = {
      events: batch.map((event) => ({
        id: event.id,
        path: event.path,
        referrer: event.referrer,
        visitorId: event.visitorId,
        durationMs: event.durationMs,
        startedAtMs: event.startedAtMs,
        userAgent: event.userAgent,
        language: event.language,
        screen: event.screen,
        createdAtMs: event.createdAtMs,
      })),
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
      });

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const payload = isJson ? await response.json().catch(() => null) : await response.text();

      if (response.ok) {
        return { kind: 'success' };
      }

      if (response.status === 401 || response.status === 403) {
        return { kind: 'auth-error' };
      }

      if (response.status === 404) {
        return { kind: 'endpoint-missing' };
      }

      if (response.status >= 400 && response.status < 500) {
        return {
          kind: 'invalid-request',
          message: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}),
        };
      }

      return {
        kind: 'retryable',
        message: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}),
      };
    } catch (error) {
      return { kind: 'retryable', message: (error as Error)?.message ?? 'network error' };
    }
  }

  private logError(message: string, error?: unknown) {
    const now = getNow();
    if (now - this.lastErrorLogAt < ERROR_LOG_INTERVAL_MS) {
      return;
    }
    this.lastErrorLogAt = now;
    if (error) {
      console.warn(message, error);
    } else {
      console.warn(message);
    }
  }
}

function getAnalyticsClient(): AnalyticsClient | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (!analyticsClient) {
    analyticsClient = new AnalyticsClient();
  }
  return analyticsClient;
}

export interface TrackPageViewOptions {
  durationMs?: number | null;
  startedAtMs?: number | null;
  referrer?: string | null;
}

export function initialiseAnalyticsClient() {
  getAnalyticsClient();
}

function normalisePath(path: string): string {
  if (!path) {
    return '/';
  }
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

function resolveUserAgent(): string | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  return navigator.userAgent || null;
}

function resolveLanguage(): string | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  return navigator.language || null;
}

function resolveScreen(): string | null {
  if (typeof window === 'undefined' || typeof window.screen === 'undefined') {
    return null;
  }
  const { width, height } = window.screen;
  if (typeof width === 'number' && typeof height === 'number') {
    return `${width}x${height}`;
  }
  return null;
}

function createQueueEvent(path: string, options?: TrackPageViewOptions): AnalyticsQueueEvent {
  const now = getNow();
  return {
    id: createVisitorId(),
    path: normalisePath(path),
    referrer: options?.referrer ?? null,
    durationMs:
      typeof options?.durationMs === 'number' && Number.isFinite(options.durationMs)
        ? Math.max(0, Math.round(options.durationMs))
        : null,
    startedAtMs:
      typeof options?.startedAtMs === 'number' && Number.isFinite(options.startedAtMs)
        ? Math.max(0, Math.round(options.startedAtMs))
        : null,
    visitorId: getVisitorId(),
    userAgent: resolveUserAgent(),
    language: resolveLanguage(),
    screen: resolveScreen(),
    createdAtMs: now,
  };
}

export function trackPageView(path: string, options?: TrackPageViewOptions) {
  if (typeof window === 'undefined') {
    return;
  }
  if (!path || typeof path !== 'string') {
    return;
  }
  const client = getAnalyticsClient();
  if (!client) {
    return;
  }
  client.enqueue(createQueueEvent(path, options));
}

export async function flushAnalyticsQueue() {
  await analyticsClient?.flush(true);
}

export const __analyticsTestExports = {
  reset() {
    analyticsClient?.dispose();
    analyticsClient = null;
    const storage = safeLocalStorage();
    storage?.removeItem(STORAGE_KEY);
    cachedVisitorId = null;
  },
  getQueue() {
    return analyticsClient?.getQueueSnapshot() ?? [];
  },
};

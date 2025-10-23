import { describe, expect, vi, beforeEach, afterEach, it, type Mock } from 'vitest';

import {
  trackPageView,
  flushAnalyticsQueue,
  __analyticsTestExports,
  initialiseAnalyticsClient,
} from '../analytics';

const { ensureFirebaseMock, resolveHttpFunctionUrlMock } = vi.hoisted(() => ({
  ensureFirebaseMock: vi.fn(async () => ({ auth: { __isPlaceholder: false, currentUser: null } })),
  resolveHttpFunctionUrlMock: vi.fn(() => 'https://example.com/analytics_track'),
}));

vi.mock('../firebase', () => ({
  ensureFirebase: ensureFirebaseMock,
}));

vi.mock('../httpFunctions', () => ({
  resolveHttpFunctionUrl: resolveHttpFunctionUrlMock,
}));

describe('analytics tracker', () => {
  const originalFetch = global.fetch;
  const originalCrypto = global.crypto;
  const randomUUIDMock = vi.fn(() => 'test-uuid');

  beforeEach(() => {
    __analyticsTestExports.reset();
    ensureFirebaseMock.mockClear();
    resolveHttpFunctionUrlMock.mockClear();
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({ ok: true }),
    })) as unknown as typeof global.fetch;
    Object.defineProperty(global, 'crypto', {
      value: { randomUUID: randomUUIDMock },
      configurable: true,
    });
    randomUUIDMock.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    __analyticsTestExports.reset();
    if (originalFetch) {
      global.fetch = originalFetch;
    }
    if (originalCrypto) {
      Object.defineProperty(global, 'crypto', {
        value: originalCrypto,
        configurable: true,
      });
    }
    vi.restoreAllMocks();
  });

  it('queues page view events with normalised metadata', () => {
    initialiseAnalyticsClient();
    trackPageView('about', { durationMs: 123.4, startedAtMs: 50, referrer: '/home' });

    const queue = __analyticsTestExports.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.path).toBe('/about');
    expect(queue[0]?.durationMs).toBe(123);
    expect(queue[0]?.startedAtMs).toBe(50);
    expect(queue[0]?.referrer).toBe('/home');
    expect(queue[0]?.id).toBe('test-uuid');
  });

  it('flushes queued events to the analytics endpoint', async () => {
    trackPageView('/contact', { durationMs: 80, startedAtMs: 10, referrer: '/' });

    const fetchMock = global.fetch as unknown as Mock;
    await flushAnalyticsQueue();

    expect(resolveHttpFunctionUrlMock).toHaveBeenCalledWith('analytics_track', {
      allowRelativeFallback: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/analytics_track');
    expect(__analyticsTestExports.getQueue()).toHaveLength(0);
  });

  it('falls back to default hosted endpoint when resolution fails', async () => {
    resolveHttpFunctionUrlMock.mockImplementationOnce(() => {
      throw new Error('missing base');
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({ ok: true }),
    }));
    global.fetch = fetchMock as unknown as typeof global.fetch;

    trackPageView('/pricing');
    await flushAnalyticsQueue();

    expect(resolveHttpFunctionUrlMock).toHaveBeenCalledWith('analytics_track', {
      allowRelativeFallback: true,
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://europe-west2-pineapple-tapped---portal.cloudfunctions.net/analytics_track',
    );
  });
});

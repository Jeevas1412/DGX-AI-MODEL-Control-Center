import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './api-client'

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

describe('ApiClient', () => {
  it('maps the Codex read-only services response without issuing non-GET requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      generatedAt: '2026-07-19T08:00:00Z',
      items: [{ id: 'nvfp4', name: 'NVFP4', status: 'running', port: 8091, residency: 'resident', uptimeSeconds: 3661, observedMemoryMiB: 34853, estimatedMemoryMiB: null }],
    }))
    const client = createApiClient({ mode: 'live', baseUrl: 'http://api.test', fetcher })

    const result = await client.getServicesState()

    expect(result.stale).toBe(false)
    expect(result.data).toEqual([expect.objectContaining({ id: 'nvfp4', type: 'nvfp4', status: 'running', port: 8091, uptime: '0d 1h 1m', observedMemoryGiB: 34 })])
    expect(fetcher).toHaveBeenCalledWith('http://api.test/api/services', expect.objectContaining({ method: 'GET' }))
  })

  it('sends a browser-stored token only as a bearer authorization header on GET requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: 'ok', generatedAt: '2026-07-20T00:00:00Z' }))
    const client = createApiClient({ mode: 'live', baseUrl: 'http://api.test', accessToken: 'session-token', fetcher })
    await client.getHealthState()
    expect(fetcher).toHaveBeenCalledWith('http://api.test/api/health', expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer session-token' } }))
    expect(client.hasAccessToken).toBe(true)
    client.setAccessToken('')
    expect(client.hasAccessToken).toBe(false)
  })

  it('restores and clears the token in the current browser storage', () => {
    const store = new Map<string, string>()
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    })

    try {
      const first = createApiClient({ mode: 'live' })
      first.setAccessToken('trusted-browser-token')
      expect(store.get('dgx-ai-control-center.api-access-token')).toBe('trusted-browser-token')

      const restored = createApiClient({ mode: 'live' })
      expect(restored.hasAccessToken).toBe(true)
      restored.setAccessToken('')
      expect(store.has('dgx-ai-control-center.api-access-token')).toBe(false)
      expect(first.hasAccessToken).toBe(true)
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('retains the last valid response and marks it stale when a later request fails', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ memoryTotalBytes: 128 * 1024 ** 3, memoryAvailableBytes: 32 * 1024 ** 3, modelMemoryBudget: { source: 'linux-memavailable', totalMiB: 128 * 1024, freeMiB: 32 * 1024, safetyReserveMiB: 128 * 102.4, allocatableMiB: 19660.8, observedModelMemoryMiB: 62510, observedModelRuntimeCount: 2 } }))
      .mockRejectedValueOnce(new Error('network unavailable'))
    const client = createApiClient({ mode: 'live', baseUrl: 'http://api.test', fetcher })

    const fresh = await client.getSystemMetricsState()
    const stale = await client.getSystemMetricsState()

    expect(fresh.stale).toBe(false)
    expect(fresh.data.memoryUsed).toBe(96)
    expect(fresh.data.modelMemoryBudget).toMatchObject({ source: 'linux-memavailable', freeGiB: 32, allocatableGiB: 19.2, observedModelMemoryGiB: 61, observedModelRuntimeCount: 2 })
    expect(stale).toMatchObject({ data: fresh.data, stale: true, error: 'network unavailable' })
  })

  it('never substitutes mock service data after an initial live request failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('network unavailable'))
    const client = createApiClient({ mode: 'live', baseUrl: 'http://api.test', fetcher })

    const result = await client.getServicesState()

    expect(result).toMatchObject({ data: [], stale: true, error: 'network unavailable' })
  })

  it('uses local mock data without calling fetch when mock mode is enabled', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const client = createApiClient({ mode: 'mock', fetcher })

    const result = await client.getModelMetricsState('vlm')

    expect(result.stale).toBe(false)
    expect(result.data.tokensPerSecond).toBeGreaterThan(0)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('maps benchmark history and preserves unavailable metrics as null', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      items: [{ id: 'p3-10', testName: 'P3 10 并发', timestamp: '2026-07-19T00:00:00Z', successRate: 100, avgTTFT: null, avgThroughput: 19.2, p50: 1300.2, p95: 2034.2, p99: 2074.2, peakMemory: null, errorCount: 0, errors: [], source: 'dgx-real' }],
    }))
    const client = createApiClient({ mode: 'live', baseUrl: 'http://api.test', fetcher })

    const result = await client.getBenchmarkHistoryState()

    expect(result.data).toEqual([expect.objectContaining({ id: 'p3-10', avgTTFT: null, avgThroughput: 19.2, peakMemory: null, source: 'dgx-real' })])
    expect(fetcher).toHaveBeenCalledWith('http://api.test/api/benchmarks', expect.objectContaining({ method: 'GET' }))
  })

  it('maps the NVFP4 startup configuration through a GET-only read contract', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ values: { maxModelLen: 65536, gpuMemoryUtilization: 0.55, maxNumSeqs: 2, maxNumBatchedTokens: 16384, kvCacheDtype: 'fp8', prefixCaching: true, mtpTokens: 3 } }))
    const client = createApiClient({ mode: 'live', baseUrl: 'http://api.test', fetcher })
    const result = await client.getNvfp4StartupConfigState()
    expect(result.data).toMatchObject({ maxModelLen: 65536, prefixCaching: true, mtpTokens: 3 })
    expect(fetcher).toHaveBeenCalledWith('http://api.test/api/models/nvfp4/config', expect.objectContaining({ method: 'GET' }))
  })

  it('maps fixed hardware telemetry without turning unavailable fields into zero', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      status: 'healthy', connection: 'connected', collectedAt: '2026-07-27T00:00:00Z', ageMs: 0, source: 'ssh-fixed-probe',
      system: { uptimeSeconds: 7200, load1: 0.1, load5: 0.2, load15: 0.3, cpuPercent: null },
      memory: { totalBytes: 128, availableBytes: null, usedBytes: null, usedPercent: null, swapTotalBytes: null, swapUsedBytes: null },
      gpu: { supported: true, utilizationPercent: null, temperatureC: null, powerWatts: null, memoryUsedBytes: null, memoryTotalBytes: null, unsupportedFields: ['temperatureC'] },
      storage: null, network: null, components: [{ id: 'smartd.service', state: 'unknown' }], freshness: { state: 'fresh', cached: false },
    }))
    const client = createApiClient({ mode: 'live', baseUrl: 'http://api.test', fetcher })
    const result = await client.getHardwareSummaryState()
    expect(result.data.system?.cpuPercent).toBeNull()
    expect(result.data.gpu?.utilizationPercent).toBeNull()
    expect(result.data.storage).toBeNull()
    expect(fetcher).toHaveBeenCalledWith('http://api.test/api/hardware/summary', expect.objectContaining({ method: 'GET' }))
  })

  it('creates a fixed local-control plan with bearer authentication', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      id: '11111111-1111-4111-8111-111111111111',
      serviceId: 'nvfp4',
      serviceName: 'NVFP4',
      action: 'warmup',
      risk: 'low',
      requiresIdle: false,
      summary: 'Warm up the fixed NVFP4 proxy.',
      createdAt: '2026-07-20T00:00:00Z',
      expiresAt: '2026-07-20T00:05:00Z',
      status: 'awaiting-confirmation',
    }, 201))
    const client = createApiClient({ mode: 'live', baseUrl: 'http://api.test', accessToken: 'session-token', fetcher })

    const plan = await client.createLocalControlPlan('nvfp4', 'warmup')

    expect(plan).toMatchObject({ serviceId: 'nvfp4', action: 'warmup', status: 'awaiting-confirmation' })
    expect(fetcher).toHaveBeenCalledWith('http://api.test/api/local-control/plans', expect.objectContaining({
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: 'Bearer session-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: 'nvfp4', action: 'warmup' }),
    }))
  })

  it('creates a managed-service restart plan through the fixed local route', async () => {
    const serviceId = '33333333-3333-4333-8333-333333333333'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      plan: { id: '44444444-4444-4444-8444-444444444444', serviceId, action: 'restart', risk: 'high', summary: 'Restart the verified service.', createdAt: '2026-07-27T00:00:00Z', expiresAt: '2026-07-27T00:05:00Z', status: 'awaiting-confirmation' },
    }, 201))
    const client = createApiClient({ mode: 'live', baseUrl: 'http://api.test', accessToken: 'session-token', fetcher })
    const plan = await client.createManagedServicePlan(serviceId, 'restart')
    expect(plan).toMatchObject({ serviceId, action: 'restart', status: 'awaiting-confirmation' })
    expect(fetcher).toHaveBeenCalledWith(`http://api.test/api/managed-services/${serviceId}/plans`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'restart' }),
    }))
  })

})

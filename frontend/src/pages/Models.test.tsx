import { describe, expect, it, vi } from 'vitest'

describe('Models page — portable catalog and parameter boundaries', () => {
  it('keeps local model discovery generic instead of exporting a named model preset', async () => {
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'mock', fetcher: vi.fn() })
    const items = await client.searchModelCatalog('')
    expect(Array.isArray(items)).toBe(true)
    expect(items.every((item) => item.source === 'dgx-local')).toBe(true)
  })

  it('adds a model through the typed catalog contract only', async () => {
    const { createApiClient } = await import('../services/api-client')
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ entry: { id: '00000000-0000-4000-8000-000000000001', source: 'dgx-local', modelId: 'example-model', displayName: 'Example model', addedAt: new Date().toISOString() } }) })
    const client = createApiClient({ mode: 'live', baseUrl: 'http://127.0.0.1:9999', fetcher })
    const entry = await client.addModelToCatalog({ resultId: 'result-1', source: 'dgx-local', modelId: 'example-model', displayName: 'Example model' })
    expect(entry.modelId).toBe('example-model')
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:9999/api/model-catalog', expect.objectContaining({ method: 'POST' }))
  })

  it('retains nullable parameter reads and does not claim parameter writing', async () => {
    const { api } = await import('../services/api')
    expect(typeof api.getNvfp4StartupConfigState).toBe('function')
    const result = await api.applyConfig()
    expect(result.success).toBe(false)
  })
})

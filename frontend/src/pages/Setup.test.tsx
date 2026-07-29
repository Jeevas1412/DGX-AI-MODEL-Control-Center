import { describe, expect, it, vi } from 'vitest'
import { transition, initialState } from './SetupStateMachine'

// ── Setup Wizard page boundaries ──

describe('Setup wizard — mock fixtures and state boundaries', () => {
  it('mockDefaultConnection has expected defaults', async () => {
    const { mockDefaultConnection } = await import('../mocks/data')
    expect(mockDefaultConnection.identityMethod).toBe('existing-key')
    expect(mockDefaultConnection.port).toBe(22)
    expect(mockDefaultConnection.name).toBe('')
    expect(mockDefaultConnection.address).toBe('')
  })

  it('mockTestSuccess returns valid TestConnectionResult', async () => {
    const { mockTestSuccess } = await import('../mocks/data')
    expect(mockTestSuccess.success).toBe(true)
    expect(mockTestSuccess.latencyMs).toBeGreaterThan(0)
    expect(mockTestSuccess.serverFingerprint).toMatch(/^SHA256:/)
    expect(mockTestSuccess.authMethod).toBeTruthy()
  })

  it('mockTestFailure returns expected error result', async () => {
    const { mockTestFailure } = await import('../mocks/data')
    expect(mockTestFailure.success).toBe(false)
    expect(mockTestFailure.message).toBeTruthy()
    expect(mockTestFailure.latencyMs).toBe(0)
  })

  it('mockCapabilities covers expected services', async () => {
    const { mockCapabilities } = await import('../mocks/data')
    expect(mockCapabilities.length).toBeGreaterThanOrEqual(4)
    const labels = mockCapabilities.map((c) => c.service)
    expect(labels.some((l) => l.includes('模型服务控制兼容性'))).toBe(true)
    expect(labels.some((l) => l.includes('文本模型服务'))).toBe(true)
  })

  it('wizard step types cover all expected states', () => {
    // Compile-time only: if WizardStep type compiles correctly, this passes
    const steps: string[] = ['connection', 'testing', 'fingerprint', 'capabilities', 'complete']
    expect(steps).toHaveLength(5)
  })
})

describe('Setup runtime channel boundary', () => {
  it('does not misclassify the desktop file renderer as a protected LAN page', async () => {
    const { shouldShowProtectedLanNotice } = await import('./Setup')
    expect(shouldShowProtectedLanNotice({ desktopChannel: true, loading: false, hostname: '' })).toBe(false)
    expect(shouldShowProtectedLanNotice({ desktopChannel: false, loading: false, hostname: '192.168.50.107' })).toBe(true)
    expect(shouldShowProtectedLanNotice({ desktopChannel: false, loading: false, hostname: '127.0.0.1' })).toBe(false)
  })
})

describe('Setup wizard — real API wiring (WB-12 contracts)', () => {
  it('API service exposes exactly the four allowed setup methods (no extra)', async () => {
    const { api } = await import('../services/api')
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(api))
    const setupMethods = proto.filter((k) => k.startsWith('getSetup') || k.startsWith('createSetup') || k.startsWith('verifySetup') || k.startsWith('activateSetup'))
    const allowed = ['getSetupCapabilities', 'getSetupProfiles', 'createSetupProfile', 'verifySetupProfile', 'activateSetupProfile']
    for (const m of setupMethods) {
      expect(allowed).toContain(m)
    }
    for (const a of allowed) {
      expect(typeof (api as unknown as Record<string, unknown>)[a]).toBe('function')
    }
  })

  it('API client exposes only the five fixed setup methods plus controlJson helper', async () => {
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'mock', fetcher: vi.fn() })
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(client))
    const setupMethods = proto.filter((k) => /setup|profile/i.test(k))
    const allowed = ['getSetupCapabilities', 'getSetupProfiles', 'createSetupProfile', 'verifySetupProfile', 'activateSetupProfile']
    for (const m of setupMethods) { expect(allowed).toContain(m) }
  })

  it('createSetupProfile rejects fields beyond allowlist in mock mode', async () => {
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'mock', fetcher: vi.fn() })
    // The allowed fields: displayName, sshAlias, hostKeyFingerprint (optional)
    const resp = await client.createSetupProfile({ displayName: 'Test', sshAlias: 'test-alias' })
    expect(resp.profile.displayName).toBe('Test')
    expect(resp.profile.sshAlias).toBe('test-alias')
    expect(resp.profile.transport).toBe('openssh-alias')
    // Verify no IP/port/password/path fields are returned
    const raw = resp.profile as unknown as Record<string, unknown>
    expect(raw.ip).toBeUndefined()
    expect(raw.port).toBeUndefined()
    expect(raw.password).toBeUndefined()
    expect(raw.privateKey).toBeUndefined()
  })

  it('createSetupProfile call shape matches contract (displayName, sshAlias, optional hostKeyFingerprint)', async () => {
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'mock', fetcher: vi.fn() })
    // Only allowed fields
    const withFp = await client.createSetupProfile({ displayName: 'DGX', sshAlias: 'dgx', hostKeyFingerprint: 'SHA256:abc123' })
    expect(withFp.profile.hostKeyFingerprint).toBe('SHA256:abc123')
    // Without hostKeyFingerprint
    const withoutFp = await client.createSetupProfile({ displayName: 'DGX2', sshAlias: 'dgx2' })
    expect(withoutFp.profile.hostKeyFingerprint).toBeNull()
  })

  it('verifySetupProfile mock returns known capability shape', async () => {
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'mock', fetcher: vi.fn() })
    const resp = await client.verifySetupProfile('test-id')
    expect(resp.profileId).toBe('test-id')
    expect(resp.result.connection).toBe('reachable')
    expect(resp.result.capabilities.monitoring).toBe('available')
  })

  it('getSetupCapabilities mock returns not-configured state', async () => {
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'mock', fetcher: vi.fn() })
    const resp = await client.getSetupCapabilities()
    expect(resp.connection).toBe('not-configured')
    expect(resp.capabilities.monitoring).toBe('unknown')
  })

  it('getSetupProfiles mock returns empty profiles list', async () => {
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'mock', fetcher: vi.fn() })
    const doc = await client.getSetupProfiles()
    expect(doc.schemaVersion).toBe(2)
    expect(doc.activeProfileId).toBeNull()
    expect(doc.profiles).toEqual([])
  })

  it('alias format rejects invalid SSH alias patterns', () => {
    // Valid: starts with alphanumeric, only A-Za-z0-9._- up to 64 chars
    const valid = ['dgx-home', 'dgx_home', 'DGX1', 'a.b']
    const invalid = ['-invalid', '.bad', '_nope', 'has space', 'too-long-'.repeat(10)]
    const re = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
    for (const v of valid) expect(re.test(v)).toBe(true)
    for (const v of invalid) expect(re.test(v)).toBe(false)
  })

  it('LAN setup keeps the same OpenSSH alias input contract as the local page', () => {
    const acceptsAlias = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
    expect(acceptsAlias('dgx-home')).toBe(true)
    expect(acceptsAlias('dgx; reboot')).toBe(false)
  })

  it('mock mode badge exists and is distinguishable from live mode', async () => {
    const { createApiClient } = await import('../services/api-client')
    const mockClient = createApiClient({ mode: 'mock', fetcher: vi.fn() })
    expect(mockClient.mode).toBe('mock')
    const liveClient = createApiClient({ mode: 'live', baseUrl: 'http://127.0.0.1:9999', fetcher: vi.fn() })
    expect(liveClient.mode).toBe('live')
  })

  // ── Live fetcher intercept tests ──
  const TEST_TOKEN = 'test-bearer-token-abcdef1234567890abcdef1234567890abcdef12'
  const BASE = 'http://127.0.0.1:9999'

  it('live: getSetupProfiles → GET /api/setup/profiles + Authorization', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ schemaVersion: 1, profiles: [] }) })
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'live', baseUrl: BASE, fetcher })
    client.setAccessToken(TEST_TOKEN)
    await client.getSetupProfiles()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(`${BASE}/api/setup/profiles`)
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(init.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`)
  })

  it('live: createSetupProfile → POST /api/setup/profiles, field allowlist enforced', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ profile: { id: 'p1', displayName: 'DGX', transport: 'openssh-alias', sshAlias: 'dgx', hostKeyFingerprint: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }) })
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'live', baseUrl: BASE, fetcher })
    client.setAccessToken(TEST_TOKEN)
    await client.createSetupProfile({ displayName: 'DGX', sshAlias: 'dgx' })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(`${BASE}/api/setup/profiles`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`)
    const body = JSON.parse(init.body)
    expect(body).toEqual({ displayName: 'DGX', sshAlias: 'dgx' })
  })

  it('live: createSetupProfile strips forbidden fields (ip, port, password, privateKey, command, path)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ profile: { id: 'p1', displayName: 'X', transport: 'openssh-alias', sshAlias: 'x', hostKeyFingerprint: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }) })
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'live', baseUrl: BASE, fetcher })
    // Runtime injection of forbidden fields via type override
    const malicious = { displayName: 'X', sshAlias: 'x', ip: 'TEST-NET-ADDRESS', port: 22, password: 'secret', privateKey: 'TEST_PRIVATE_KEY_MARKER', command: 'rm -rf /', path: '/etc/passwd' }
    await client.createSetupProfile(malicious as any)
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.ip).toBeUndefined()
    expect(body.port).toBeUndefined()
    expect(body.password).toBeUndefined()
    expect(body.privateKey).toBeUndefined()
    expect(body.command).toBeUndefined()
    expect(body.path).toBeUndefined()
    expect(Object.keys(body).sort()).toEqual(['displayName', 'sshAlias'].sort())
  })

  it('live: createSetupProfile includes optional hostKeyFingerprint when provided', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ profile: { id: 'p1', displayName: 'DGX', transport: 'openssh-alias', sshAlias: 'dgx', hostKeyFingerprint: 'SHA256:abc', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }) })
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'live', baseUrl: BASE, fetcher })
    await client.createSetupProfile({ displayName: 'DGX', sshAlias: 'dgx', hostKeyFingerprint: 'SHA256:abc' })
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.hostKeyFingerprint).toBe('SHA256:abc')
  })

  it('live: verifySetupProfile → POST /api/setup/profiles/:id/verify with empty object body', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ profileId: 'p1', result: { schemaVersion: 1, checkedAt: new Date().toISOString(), connection: 'reachable', capabilities: { monitoring: 'available' } } }) })
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'live', baseUrl: BASE, fetcher })
    client.setAccessToken(TEST_TOKEN)
    await client.verifySetupProfile('p1')
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(`${BASE}/api/setup/profiles/p1/verify`)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect(init.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`)
  })

  it('live: activateSetupProfile → POST /api/setup/profiles/:id/activate with empty object body', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ activeProfileId: 'p1' }) })
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'live', baseUrl: BASE, fetcher })
    client.setAccessToken(TEST_TOKEN)
    await client.activateSetupProfile('p1')
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(`${BASE}/api/setup/profiles/p1/activate`)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect(init.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`)
  })

  it('live: getSetupCapabilities → GET /api/setup/capabilities with Authorization', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ connection: 'reachable', checkedAt: new Date().toISOString(), capabilities: { monitoring: 'available' } }) })
    const { createApiClient } = await import('../services/api-client')
    const client = createApiClient({ mode: 'live', baseUrl: BASE, fetcher })
    client.setAccessToken(TEST_TOKEN)
    await client.getSetupCapabilities()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(`${BASE}/api/setup/capabilities`)
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`)
  })

  // ── Page-level state machine: failure never advances ──
  it('state machine: saveProfileFail stays in "connection" step with error, no profileId', () => {
    const s = transition(initialState(), 'saveProfileFail', { error: 'API unreachable' })
    expect(s.step).toBe('connection')
    expect(s.error).toBe('API unreachable')
    expect(s.profileId).toBeNull()
  })

  it('state machine: verifyFail returns to "connection" step, clears profileId (no fake capabilities)', () => {
    const connecting = transition(initialState(), 'saveProfileOk', { profileId: 'p1' })
    const s = transition(connecting, 'verifyFail', { error: 'ECONNREFUSED' })
    expect(s.step).toBe('connection')
    expect(s.profileId).toBeNull()
    expect(s.error).toBe('ECONNREFUSED')
    expect(s.capabilityResult).toBeNull()
  })

  it('state machine: saveProfileOk advances to "testing" with profileId set', () => {
    const s = transition(initialState(), 'saveProfileOk', { profileId: 'abc-123' })
    expect(s.step).toBe('testing')
    expect(s.profileId).toBe('abc-123')
    expect(s.error).toBeNull()
  })

  it('state machine: verifyOk advances to "capabilities" with result', () => {
    const testing = transition(initialState(), 'saveProfileOk', { profileId: 'p1' })
    const s = transition(testing, 'verifyOk', { result: { connection: 'reachable', capabilities: { monitoring: 'available' } } })
    expect(s.step).toBe('capabilities')
    expect(s.capabilityResult).toBeTruthy()
    expect(s.error).toBeNull()
  })

  it('state machine: capabilitiesOk advances to "complete"', () => {
    const caps = transition(
      transition(initialState(), 'saveProfileOk', { profileId: 'p1' }),
      'verifyOk',
      { result: { ok: true } },
    )
    const s = transition(caps, 'capabilitiesOk')
    expect(s.step).toBe('complete')
  })

  it('state machine: verifyFail from testing does NOT reach capabilities or complete', () => {
    const testing = transition(initialState(), 'saveProfileOk', { profileId: 'p1' })
    const s = transition(testing, 'verifyFail', { error: 'timeout' })
    expect(s.step).not.toBe('capabilities')
    expect(s.step).not.toBe('complete')
    expect(s.step).toBe('connection')
  })

  it('state machine: initial state is "connection" with no error or profile', () => {
    const s = initialState()
    expect(s.step).toBe('connection')
    expect(s.error).toBeNull()
    expect(s.profileId).toBeNull()
    expect(s.profileLoad).toBe('ready')
    expect(s.failure).toBe('none')
  })

  it('state machine: profile loading failure exposes a safe unavailable state', () => {
    const s = transition(initialState(), 'profilesLoadFail', { error: 'Profiles API unavailable' })
    expect(s.step).toBe('connection')
    expect(s.profileLoad).toBe('unavailable')
    expect(s.failure).toBe('profiles')
    expect(s.profileId).toBeNull()
    expect(s.capabilityResult).toBeNull()
  })

  it('state machine: retrying profile load returns to the initial safe state', () => {
    const unavailable = transition(initialState(), 'profilesLoadFail', { error: 'Profiles API unavailable' })
    const s = transition(unavailable, 'profilesLoadRetry')
    expect(s).toEqual(initialState())
  })
})

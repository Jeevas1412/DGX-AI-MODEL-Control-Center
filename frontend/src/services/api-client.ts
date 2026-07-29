import type { ActivateProfileResponse, BenchmarkResult, CreateProfileRequest, CreateProfileResponse, LogEntry, ModelMetrics, ModelType, Nvfp4StartupConfig, RequestRecord, ServiceInfo, ServiceStatus, SetupCapabilities, SetupProfilesDoc, SystemMetrics, VerifyProfileResponse } from '../types'
import { mockLogs, mockModelMetrics, mockRequests, mockServices, mockSystemMetrics } from '../mocks/data'

export type ApiMode = 'mock' | 'live'

export class ApiRequestError extends Error {
  readonly code: string | null
  readonly status: number
  readonly requestId: string | null

  constructor(message: string, { code = null, status = 0, requestId = null }: { code?: string | null; status?: number; requestId?: string | null } = {}) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}
export type ApiResource = 'health' | 'connectionStatus' | 'remoteDesktopStatus' | 'hardwareSummary' | 'services' | 'system' | 'nvfp4Metrics' | 'vlmMetrics' | 'nvfp4Config' | 'requests' | 'logs' | 'benchmarks'

export interface ReadResult<T> {
  data: T
  stale: boolean
  updatedAt: string
  error?: string
}

export interface ApiClientOptions {
  mode?: ApiMode
  baseUrl?: string
  accessToken?: string
  fetcher?: typeof fetch
  now?: () => Date
}
export interface DgxConnectionStatus { status: 'connected' | 'disconnected' | 'not-configured'; checkedAt: string }
export interface RemoteDesktopStatus {
  state: 'ready' | 'requires-admin-bootstrap' | 'externally-managed' | 'unsupported' | 'conflict' | 'unreachable' | 'not-configured'
  checkedAt: string
  service: 'active' | 'inactive' | 'absent' | 'unknown'
  listener: 'listening' | 'not-listening' | 'unknown'
  nla: 'required' | 'not-required' | 'unknown'
  management: 'product-managed' | 'external' | 'not-configured' | 'unknown'
  nextStep: string
}
export type HardwareState = 'healthy' | 'warning' | 'critical' | 'unknown' | 'unsupported' | 'unavailable' | 'stale' | 'not-configured'
export type HardwareHistoryMetric = 'gpuUtilizationPercent' | 'cpuPercent' | 'memoryUsedPercent' | 'rootUsedPercent'
export type HardwareHistoryRange = '15m' | '1h' | '6h' | '24h' | '7d'
export interface HardwareSummary {
  status: HardwareState
  connection: 'connected' | 'not-configured' | 'unknown'
  collectedAt: string
  ageMs: number | null
  source: string
  system: { uptimeSeconds: number | null; load1: number | null; load5: number | null; load15: number | null; cpuPercent: number | null } | null
  memory: { totalBytes: number | null; availableBytes: number | null; usedBytes: number | null; usedPercent: number | null; swapTotalBytes: number | null; swapUsedBytes: number | null } | null
  gpu: { supported: boolean; utilizationPercent: number | null; temperatureC: number | null; powerWatts: number | null; memoryUsedBytes: number | null; memoryTotalBytes: number | null; unsupportedFields: string[] } | null
  storage: { rootTotalBytes: number | null; rootUsedBytes: number | null; rootAvailableBytes: number | null; rootUsedPercent: number | null; smart: string } | null
  network: { receivedBytes: number | null; sentBytes: number | null } | null
  components: Array<{ id: string; state: 'active' | 'inactive' | 'unknown' }>
  freshness: { state: 'fresh' | 'unavailable' | 'not-configured'; cached: boolean }
}
export interface HardwareHistoryPoint { timestamp: string; state: 'fresh' | 'unavailable' | 'stale'; value: number | null }

export type LocalControlAction = 'warmup' | 'restart' | 'stop'

export interface LocalControlPlan {
  id: string
  serviceId: string
  serviceName: string
  action: LocalControlAction
  risk: 'medium' | 'high'
  requiresIdle: boolean
  summary: string
  createdAt: string
  expiresAt: string
  status: 'awaiting-confirmation'
}

export interface LocalControlOperation {
  id: string
  planId: string
  serviceId: string
  serviceName: string
  action: LocalControlAction
  status: 'running' | 'succeeded' | 'failed'
  phase: string
  message: string
  startedAt: string
  completedAt: string | null
}

export interface CatalogModelEntry {
  id: string
  source: 'dgx-local'
  modelId: string
  displayName: string
  addedAt: string
}

export interface CatalogSearchResult {
  resultId: string
  source: 'dgx-local'
  modelId: string
  displayName: string
}

export interface ModelServiceTemplate { id: string; kind: 'text' | 'vision' | 'image'; displayName: string; status: 'requires-adapter'; actions: LocalControlAction[] }
export interface ModelServiceDraft { id: string; catalogEntryId: string; templateId: string; displayName: string; status: 'draft' | 'registered'; createdAt: string; registeredAt?: string; adapterId?: string; adapterVersion?: string }
export interface ModelServicePrecheck { configurationId: string; eligible: boolean; registrationEligible?: boolean; checks: Array<{ id: string; status: 'passed' | 'blocked' | 'failed'; message: string }>; nextStep: string }
export interface ModelServiceRegistrationPlan { id: string; configurationId: string; action: 'register-managed-service'; risk: 'high'; summary: string; createdAt: string; expiresAt: string; status: 'awaiting-confirmation' }
export interface ManagedServicePlan { id: string; serviceId: string; action: LocalControlAction; risk: 'high'; summary: string; createdAt: string; expiresAt: string; status: 'awaiting-confirmation'; requiresIdle?: boolean }
export interface ModelServiceAdapter { id: string; version: string; templateId: string; modelIds: string[]; integritySha256: string; actions: LocalControlAction[]; healthCheck: { kind: 'service-health' | 'workflow-ready' }; resourceBudget: { estimatedMemoryMiB: number }; parameters?: Array<{ id: string; type: 'integer' | 'number' | 'boolean'; minimum: number | null; maximum: number | null; step: number | null; risk: 'medium' | 'high' }> }
export interface Nvfp4ParameterReview {
  review: { approvedForExecution: false; errors: string[]; changes: Array<{ field: string; flag: string; from: unknown; to: unknown; risk: 'high'; requiresRestart: true }>; requiredGates: string[] }
  audit: { changeId: string; recordedAt: string; snapshotId: string; scriptHash: string; executionAllowed: false; executionResult: 'not-executed' }
}
export interface Nvfp4ParameterAdapterStatus { installed: boolean; unavailable?: boolean; id?: string; version?: string; integritySha256?: string }
export interface Nvfp4ParameterAdapterDeploymentPlan { id: string; adapterId: string; adapterVersion: string; adapterIntegritySha256: string; createdAt: string; expiresAt: string; status: 'awaiting-confirmation' }
export interface Nvfp4ParameterPlan { id: string; action: 'apply' | 'rollback'; backupId: string; createdAt: string; expiresAt: string; status: 'awaiting-second-confirmation'; summary: string }
export interface Nvfp4ParameterOperation { id: string; action: 'applied-pending-restart' | 'rolled-back'; backupId: string; createdAt: string; message: string }

type Fetcher = typeof fetch
type BackendRecord = Record<string, unknown>

const GiB = 1024 ** 3
const MiB = 1024 ** 2
const ACCESS_TOKEN_STORAGE_KEY = 'dgx-ai-control-center.api-access-token'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const nullableNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const percent = (value: unknown) => Math.round(number(value) * 1000) / 10

function readPersistedToken(): string {
  try {
    return globalThis.localStorage?.getItem(ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

function persistToken(token: string): void {
  try {
    if (token) globalThis.localStorage?.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
    else globalThis.localStorage?.removeItem(ACCESS_TOKEN_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts; keep the in-memory token only.
  }
}

function desktopApi() {
  const candidate = globalThis.window?.dgxDesktop
  return candidate && typeof candidate.requestApi === 'function' ? candidate : null
}

function desktopFetcher(bridge: NonNullable<ReturnType<typeof desktopApi>>): Fetcher {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const method = init?.method === 'POST' ? 'POST' : 'GET'
    let body: unknown
    if (method === 'POST') {
      if (typeof init?.body !== 'string') throw new Error('Desktop requests require a structured JSON body.')
      body = JSON.parse(init.body)
    }
    const result = await bridge.requestApi({ method, path: `${url.pathname}${url.search}`, ...(method === 'POST' ? { body } : {}) })
    return new Response(JSON.stringify(result.payload), { status: result.status, headers: { 'Content-Type': 'application/json' } })
  }
}

function formatDuration(seconds: unknown): string {
  const total = nullableNumber(seconds)
  if (total === null) return '—'
  const rounded = Math.max(0, Math.round(total))
  const days = Math.floor(rounded / 86400)
  const hours = Math.floor((rounded % 86400) / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  return `${days}d ${hours}h ${minutes}m`
}

function serviceType(id: string): ModelType {
  if (id.includes('vlm')) return 'vlm'
  if (id.includes('nvfp4')) return 'nvfp4'
  if (id.includes('image')) return 'image'
  return 'generic'
}

function serviceStatus(value: unknown): ServiceStatus {
  if (value === 'running') return 'running'
  if (value === 'idle') return 'idle'
  if (value === 'loading') return 'loading'
  if (value === 'error') return 'error'
  if (value === 'stopped') return 'stopped'
  if (value === 'registered') return 'registered'
  if (value === 'adapter-unavailable') return 'adapter-unavailable'
  return 'offline'
}

function mapServices(payload: unknown): ServiceInfo[] {
  const candidate = (payload as BackendRecord)?.items
  const items: unknown[] = Array.isArray(candidate) ? candidate : []
  return items.map((item, index) => {
    const raw = item as BackendRecord
    const id = text(raw.id, `service-${index}`)
    return {
      id,
      name: text(raw.name, id),
      type: text(raw.type, serviceType(id)) as ModelType,
      status: serviceStatus(raw.status),
      port: nullableNumber(raw.port),
      uptime: formatDuration(raw.uptimeSeconds),
      memoryUsage: Math.round((nullableNumber(raw.observedMemoryMiB) ?? 0) / 102.4) / 10,
      gpuMemoryUsage: Math.round((nullableNumber(raw.observedMemoryMiB) ?? 0) / 102.4) / 10,
      requestQueue: 0,
      residency: raw.residency === 'resident' ? 'resident' : raw.residency === 'on-demand' ? 'on-demand' : 'unknown',
      runningRequests: 0,
      observedMemoryGiB: nullableNumber(raw.observedMemoryMiB) === null ? null : Math.round((nullableNumber(raw.observedMemoryMiB) as number / 1024) * 10) / 10,
      estimatedMemoryGiB: nullableNumber(raw.estimatedMemoryMiB) === null ? null : Math.round((nullableNumber(raw.estimatedMemoryMiB) as number / 1024) * 10) / 10,
      estimateSource: raw.estimateSource === 'configured-reservation' || raw.estimateSource === 'adapter-reservation' ? raw.estimateSource : null,
      control: raw.control === 'managed' ? 'managed' : raw.control === 'local' ? 'local' : 'none',
      managedServiceId: text(raw.managedServiceId) || undefined,
      managedActions: Array.isArray(raw.managedActions) ? raw.managedActions.filter((action): action is LocalControlAction => action === 'warmup' || action === 'restart' || action === 'stop') : [],
    }
  })
}

function mapSystem(payload: unknown): SystemMetrics {
  const raw = payload as BackendRecord
  const memoryTotal = number(raw.memoryTotalBytes) / GiB
  const memoryAvailable = number(raw.memoryAvailableBytes) / GiB
  const budget = raw.modelMemoryBudget as BackendRecord | undefined
  const toGiB = (value: unknown) => {
    const result = nullableNumber(value)
    return result === null ? null : Math.round((result / 1024) * 10) / 10
  }
  return {
    cpuUsage: 0,
    memoryTotal: Math.round(memoryTotal * 10) / 10,
    memoryUsed: Math.round(Math.max(0, memoryTotal - memoryAvailable) * 10) / 10,
    memoryAvailable: Math.round(memoryAvailable * 10) / 10,
    gpuMemoryTotal: Math.round((number(raw.gpuMemoryTotalMiB) * MiB / GiB) * 10) / 10,
    gpuMemoryUsed: Math.round((number(raw.gpuMemoryUsedMiB) * MiB / GiB) * 10) / 10,
    gpuUtilization: number(raw.gpuUtilizationPercent),
    gpuPowerWatts: number(raw.gpuPowerWatts),
    gpuTemperatureCelsius: number(raw.gpuTemperatureCelsius),
    uptime: '—',
    modelMemoryBudget: budget ? {
      source: budget.source === 'linux-memavailable' ? 'linux-memavailable' : 'unavailable',
      totalGiB: toGiB(budget.totalMiB),
      freeGiB: toGiB(budget.freeMiB),
      safetyReserveGiB: toGiB(budget.safetyReserveMiB),
      allocatableGiB: toGiB(budget.allocatableMiB),
      observedModelMemoryGiB: toGiB(budget.observedModelMemoryMiB),
      observedModelRuntimeCount: nullableNumber(budget.observedModelRuntimeCount),
      observedOtherGpuComputeGiB: toGiB(budget.observedOtherGpuComputeMiB),
    } : undefined,
  }
}

function mapMetrics(payload: unknown): ModelMetrics {
  const raw = payload as BackendRecord
  return {
    ttft: Math.round(number(raw.ttftMs) * 10) / 10,
    tokensPerSecond: Math.round(number(raw.tokensPerSecond) * 10) / 10,
    prefixCacheHitRate: percent(raw.prefixCacheHitRate),
    mtpAcceptRate: percent(raw.mtpAcceptanceRate),
    activeRequests: number(raw.runningRequests),
    queuedRequests: number(raw.queuedRequests),
  }
}

function mapRequests(payload: unknown): RequestRecord[] {
  const candidate = (payload as BackendRecord)?.items
  const items: unknown[] = Array.isArray(candidate) ? candidate : []
  return items.map((item, index) => {
    const raw = item as BackendRecord
    const status = ['running', 'queued', 'completed', 'failed'].includes(text(raw.status)) ? text(raw.status) as RequestRecord['status'] : 'running'
    return {
      id: text(raw.id, `request-${index}`),
      model: text(raw.model, 'unknown'),
      status,
      startTime: text(raw.startTime, new Date(0).toISOString()),
      endTime: typeof raw.endTime === 'string' ? raw.endTime : undefined,
      promptLength: number(raw.promptLength),
      outputTokens: number(raw.outputTokens),
      ttft: number(raw.ttftMs ?? raw.ttft),
      throughput: number(raw.tokensPerSecond ?? raw.throughput),
    }
  })
}

function mapLogs(payload: unknown, service: string): LogEntry[] {
  const candidate = (payload as BackendRecord)?.items
  const items: unknown[] = Array.isArray(candidate) ? candidate : []
  return items.map((item, index) => {
    const raw = item as BackendRecord
    const level = text(raw.level)
    return {
      id: `${service}-${index}-${text(raw.timestamp, 'no-time')}`,
      timestamp: text(raw.timestamp, new Date(0).toISOString()),
      level: level === 'warning' ? 'warn' : level === 'error' || level === 'critical' ? 'error' : 'info',
      service,
      message: text(raw.message),
    }
  })
}

function mapBenchmarkHistory(payload: unknown): BenchmarkResult[] {
  const candidate = (payload as BackendRecord)?.items
  const items: unknown[] = Array.isArray(candidate) ? candidate : []
  return items.map((item, index) => {
    const raw = item as BackendRecord
    const errors = Array.isArray(raw.errors) ? raw.errors.filter((value): value is string => typeof value === 'string') : []
    return {
      id: text(raw.id, `benchmark-${index}`),
      testName: text(raw.testName, '未命名测试'),
      timestamp: text(raw.timestamp, new Date(0).toISOString()),
      successRate: number(raw.successRate),
      avgTTFT: nullableNumber(raw.avgTTFT),
      avgThroughput: nullableNumber(raw.avgThroughput),
      p50: number(raw.p50),
      p95: number(raw.p95),
      p99: number(raw.p99),
      peakMemory: nullableNumber(raw.peakMemory),
      errorCount: number(raw.errorCount),
      errors,
      source: raw.source === 'dgx-real' || raw.source === 'mock' ? raw.source : undefined,
    }
  })
}

function mapNvfp4Config(payload: unknown): Nvfp4StartupConfig {
  const raw = ((payload as BackendRecord)?.values ?? {}) as BackendRecord
  return { maxModelLen: nullableNumber(raw.maxModelLen), gpuMemoryUtilization: nullableNumber(raw.gpuMemoryUtilization), maxNumSeqs: nullableNumber(raw.maxNumSeqs), maxNumBatchedTokens: nullableNumber(raw.maxNumBatchedTokens), kvCacheDtype: typeof raw.kvCacheDtype === 'string' ? raw.kvCacheDtype : null, prefixCaching: typeof raw.prefixCaching === 'boolean' ? raw.prefixCaching : null, mtpTokens: nullableNumber(raw.mtpTokens) }
}

function hardwareState(value: unknown): HardwareState {
  return ['healthy', 'warning', 'critical', 'unknown', 'unsupported', 'unavailable', 'stale', 'not-configured'].includes(text(value)) ? text(value) as HardwareState : 'unknown'
}
function mapHardwareSummary(payload: unknown): HardwareSummary {
  const raw = payload as BackendRecord
  const record = (value: unknown): BackendRecord => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as BackendRecord : {}
  const nullable = (value: unknown) => nullableNumber(value)
  const system = record(raw.system)
  const memory = record(raw.memory)
  const gpu = record(raw.gpu)
  const storage = record(raw.storage)
  const network = record(raw.network)
  const freshness = record(raw.freshness)
  return {
    status: hardwareState(raw.status), connection: raw.connection === 'connected' || raw.connection === 'not-configured' ? raw.connection : 'unknown', collectedAt: text(raw.collectedAt, new Date(0).toISOString()), ageMs: nullable(raw.ageMs), source: text(raw.source, 'unavailable'),
    system: raw.system === null ? null : { uptimeSeconds: nullable(system.uptimeSeconds), load1: nullable(system.load1), load5: nullable(system.load5), load15: nullable(system.load15), cpuPercent: nullable(system.cpuPercent) },
    memory: raw.memory === null ? null : { totalBytes: nullable(memory.totalBytes), availableBytes: nullable(memory.availableBytes), usedBytes: nullable(memory.usedBytes), usedPercent: nullable(memory.usedPercent), swapTotalBytes: nullable(memory.swapTotalBytes), swapUsedBytes: nullable(memory.swapUsedBytes) },
    gpu: raw.gpu === null ? null : { supported: gpu.supported === true, utilizationPercent: nullable(gpu.utilizationPercent), temperatureC: nullable(gpu.temperatureC), powerWatts: nullable(gpu.powerWatts), memoryUsedBytes: nullable(gpu.memoryUsedBytes), memoryTotalBytes: nullable(gpu.memoryTotalBytes), unsupportedFields: Array.isArray(gpu.unsupportedFields) ? gpu.unsupportedFields.filter((value): value is string => typeof value === 'string') : [] },
    storage: raw.storage === null ? null : { rootTotalBytes: nullable(storage.rootTotalBytes), rootUsedBytes: nullable(storage.rootUsedBytes), rootAvailableBytes: nullable(storage.rootAvailableBytes), rootUsedPercent: nullable(storage.rootUsedPercent), smart: text(storage.smart, 'unknown') },
    network: raw.network === null ? null : { receivedBytes: nullable(network.receivedBytes), sentBytes: nullable(network.sentBytes) },
    components: Array.isArray(raw.components) ? raw.components.map((value) => record(value)).filter((value) => typeof value.id === 'string' && ['active', 'inactive', 'unknown'].includes(text(value.state))).map((value) => ({ id: text(value.id), state: text(value.state) as 'active' | 'inactive' | 'unknown' })) : [],
    freshness: { state: freshness.state === 'fresh' || freshness.state === 'unavailable' || freshness.state === 'not-configured' ? freshness.state : 'unavailable', cached: freshness.cached === true },
  }
}

function unavailableSystemMetrics(): SystemMetrics {
  return {
    cpuUsage: 0,
    memoryTotal: 0,
    memoryUsed: 0,
    memoryAvailable: 0,
    gpuMemoryTotal: 0,
    gpuMemoryUsed: 0,
    gpuUtilization: 0,
    gpuPowerWatts: 0,
    gpuTemperatureCelsius: 0,
    uptime: 'unavailable',
    modelMemoryBudget: undefined,
  }
}

function unavailableModelMetrics(): ModelMetrics {
  return { ttft: 0, tokensPerSecond: 0, prefixCacheHitRate: 0, mtpAcceptRate: 0, activeRequests: 0, queuedRequests: 0 }
}

export class ApiClient {
  readonly mode: ApiMode
  readonly baseUrl: string
  private readonly fetcher: Fetcher
  private readonly now: () => Date
  private readonly cache = new Map<string, ReadResult<unknown>>()
  private accessToken: string
  private readonly desktopBridge: NonNullable<ReturnType<typeof desktopApi>> | null

  constructor(options: ApiClientOptions = {}) {
    this.desktopBridge = desktopApi()
    this.mode = options.mode ?? (this.desktopBridge || import.meta.env.VITE_USE_MOCK_DATA === 'false' ? 'live' : 'mock')
    this.baseUrl = (options.baseUrl ?? (this.desktopBridge ? 'http://desktop.local' : import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8501')).replace(/\/$/, '')
    this.fetcher = options.fetcher ?? (this.desktopBridge ? desktopFetcher(this.desktopBridge) : globalThis.fetch.bind(globalThis))
    this.now = options.now ?? (() => new Date())
    this.accessToken = this.desktopBridge ? '' : options.accessToken?.trim() ?? readPersistedToken()
  }

  get hasAccessToken(): boolean { return Boolean(this.desktopBridge) || Boolean(this.accessToken) }

  setAccessToken(token: string): void {
    if (this.desktopBridge) return
    this.accessToken = token.trim()
    persistToken(this.accessToken)
  }

  async getLocalControlCapabilities(): Promise<{ enabled: boolean; localOnly: boolean; services: string[]; actions: LocalControlAction[] }> {
    if (this.mode === 'mock') return { enabled: false, localOnly: true, services: [], actions: [] }
    return this.controlJson('/api/local-control/capabilities', 'GET') as Promise<{ enabled: boolean; localOnly: boolean; services: string[]; actions: LocalControlAction[] }>
  }
  async getDgxConnectionStatus(): Promise<DgxConnectionStatus> {
    if (this.mode === 'mock') return { status: 'not-configured', checkedAt: new Date().toISOString() }
    return this.controlJson('/api/connection-status', 'GET') as Promise<DgxConnectionStatus>
  }

  async getDgxConnectionStatusState(): Promise<ReadResult<DgxConnectionStatus>> {
    return this.read(
      'connectionStatus',
      () => ({ status: 'not-configured', checkedAt: this.now().toISOString() }),
      () => this.getDgxConnectionStatus(),
      () => ({ status: 'disconnected', checkedAt: this.now().toISOString() }),
    )
  }

  async getRemoteDesktopStatus(): Promise<RemoteDesktopStatus> {
    if (this.mode === 'mock') return { state: 'not-configured', checkedAt: this.now().toISOString(), service: 'unknown', listener: 'unknown', nla: 'unknown', management: 'not-configured', nextStep: '请先完成 DGX 远程桌面受控部署。' }
    return this.controlJson('/api/remote-desktop/status', 'GET') as Promise<RemoteDesktopStatus>
  }

  async getRemoteDesktopStatusState(): Promise<ReadResult<RemoteDesktopStatus>> {
    const unavailable = (): RemoteDesktopStatus => ({ state: 'unreachable', checkedAt: this.now().toISOString(), service: 'unknown', listener: 'unknown', nla: 'unknown', management: 'unknown', nextStep: '无法读取远程桌面状态；不会自动执行修复。' })
    return this.read(
      'remoteDesktopStatus',
      () => ({ state: 'not-configured', checkedAt: this.now().toISOString(), service: 'unknown', listener: 'unknown', nla: 'unknown', management: 'not-configured', nextStep: '请先完成 DGX 远程桌面受控部署。' }),
      () => this.getRemoteDesktopStatus(),
      unavailable,
    )
  }

  async getHardwareSummary(): Promise<HardwareSummary> {
    if (this.mode === 'mock') return mapHardwareSummary({ status: 'not-configured', connection: 'not-configured', collectedAt: this.now().toISOString(), ageMs: null, source: 'unavailable', system: null, memory: null, gpu: null, storage: null, network: null, components: [], freshness: { state: 'not-configured', cached: false } })
    return mapHardwareSummary(await this.getJson('/api/hardware/summary'))
  }
  async getHardwareSummaryState(): Promise<ReadResult<HardwareSummary>> {
    const unavailable = () => mapHardwareSummary({ status: 'unavailable', connection: 'unknown', collectedAt: this.now().toISOString(), ageMs: null, source: 'unavailable', system: null, memory: null, gpu: null, storage: null, network: null, components: [], freshness: { state: 'unavailable', cached: false } })
    return this.read('hardwareSummary', () => mapHardwareSummary({ status: 'not-configured', connection: 'not-configured', collectedAt: this.now().toISOString(), ageMs: null, source: 'unavailable', system: null, memory: null, gpu: null, storage: null, network: null, components: [], freshness: { state: 'not-configured', cached: false } }), () => this.getHardwareSummary(), unavailable)
  }
  async getHardwareHistory(metric: HardwareHistoryMetric, range: HardwareHistoryRange): Promise<HardwareHistoryPoint[]> {
    if (this.mode === 'mock') return []
    const raw = await this.getJson(`/api/hardware/history?metric=${metric}&range=${range}`) as BackendRecord
    return Array.isArray(raw.items) ? raw.items.filter((item): item is BackendRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).filter((item) => typeof item.timestamp === 'string').map((item) => ({ timestamp: text(item.timestamp), state: item.state === 'fresh' || item.state === 'unavailable' || item.state === 'stale' ? item.state : 'unavailable', value: nullableNumber(item.value) })) : []
  }
  async getHardwareHistoryState(metric: HardwareHistoryMetric, range: HardwareHistoryRange): Promise<ReadResult<HardwareHistoryPoint[]>> {
    return this.read(`hardware:${metric}:${range}`, () => [], () => this.getHardwareHistory(metric, range), () => [])
  }

  async getModelCatalog(): Promise<CatalogModelEntry[]> {
    if (this.mode === 'mock') return []
    const payload = await this.controlJson('/api/model-catalog', 'GET') as { entries?: CatalogModelEntry[] }
    return Array.isArray(payload.entries) ? payload.entries : []
  }

  async searchModelCatalog(query: string): Promise<CatalogSearchResult[]> {
    if (this.mode === 'mock') return []
    const suffix = query.trim() ? `?q=${encodeURIComponent(query)}` : ''
    const payload = await this.controlJson(`/api/model-catalog/search${suffix}`, 'GET') as { items?: CatalogSearchResult[] }
    return Array.isArray(payload.items) ? payload.items : []
  }

  async addModelToCatalog(entry: CatalogSearchResult): Promise<CatalogModelEntry> {
    const payload = await this.controlJson('/api/model-catalog', 'POST', { resultId: entry.resultId }) as { entry?: CatalogModelEntry }
    if (!payload.entry) throw new Error('Model catalog did not return an entry.')
    return payload.entry
  }

  async getModelServiceTemplates(): Promise<ModelServiceTemplate[]> {
    if (this.mode === 'mock') return []
    const payload = await this.controlJson('/api/model-service-templates', 'GET') as { items?: ModelServiceTemplate[] }
    return Array.isArray(payload.items) ? payload.items : []
  }
  async getModelServiceAdapters(): Promise<ModelServiceAdapter[]> { const payload = await this.controlJson('/api/model-service-adapters', 'GET') as { items?: ModelServiceAdapter[] }; return Array.isArray(payload.items) ? payload.items : [] }
  async getModelServiceDrafts(): Promise<ModelServiceDraft[]> {
    if (this.mode === 'mock') return []
    const payload = await this.controlJson('/api/model-service-configurations', 'GET') as { entries?: ModelServiceDraft[] }
    return Array.isArray(payload.entries) ? payload.entries : []
  }

  async createModelServiceDraft(input: { catalogEntryId: string; templateId: string; displayName: string }): Promise<ModelServiceDraft> {
    const payload = await this.controlJson('/api/model-service-configurations', 'POST', input) as { entry?: ModelServiceDraft }
    if (!payload.entry) throw new Error('Model service configuration did not return an entry.')
    return payload.entry
  }
  async precheckModelServiceDraft(id: string): Promise<ModelServicePrecheck> { return this.controlJson(`/api/model-service-configurations/${id}/precheck`, 'GET') as Promise<ModelServicePrecheck> }
  async createModelServiceRegistrationPlan(id: string): Promise<ModelServiceRegistrationPlan> {
    const payload = await this.controlJson(`/api/model-service-configurations/${id}/registration-plans`, 'POST', {}) as { plan?: ModelServiceRegistrationPlan }
    if (!payload.plan) throw new Error('Model service registration plan did not return a plan.')
    return payload.plan
  }
  async confirmModelServiceRegistrationPlan(id: string): Promise<ModelServiceDraft> {
    const payload = await this.controlJson(`/api/model-service-registration-plans/${id}/confirm`, 'POST', {}) as { entry?: ModelServiceDraft }
    if (!payload.entry) throw new Error('Model service registration did not return an entry.')
    return payload.entry
  }
  async createManagedServicePlan(id: string, action: LocalControlAction): Promise<ManagedServicePlan> { const payload = await this.controlJson(`/api/managed-services/${id}/plans`, 'POST', { action }) as { plan?: ManagedServicePlan }; if (!payload.plan) throw new Error('Managed service plan did not return a plan.'); return payload.plan }
  async confirmManagedServicePlan(id: string): Promise<{ status: string; message: string }> { return this.controlJson(`/api/managed-service-plans/${id}/confirm`, 'POST', {}) as Promise<{ status: string; message: string }> }
  async createNvfp4ParameterReview(proposed: Record<string, number | boolean | string>): Promise<Nvfp4ParameterReview> {
    return this.controlJson('/api/models/nvfp4/parameter-review', 'POST', { proposed }) as Promise<Nvfp4ParameterReview>
  }
  async getNvfp4ParameterAdapterStatus(): Promise<Nvfp4ParameterAdapterStatus> { return this.controlJson('/api/models/nvfp4/parameter-adapter', 'GET') as Promise<Nvfp4ParameterAdapterStatus> }
  async createNvfp4ParameterAdapterDeploymentPlan(): Promise<Nvfp4ParameterAdapterDeploymentPlan> { const payload = await this.controlJson('/api/models/nvfp4/parameter-adapter/deployment-plans', 'POST', {}) as { plan?: Nvfp4ParameterAdapterDeploymentPlan }; if (!payload.plan) throw new Error('Parameter adapter deployment plan did not return a plan.'); return payload.plan }
  async confirmNvfp4ParameterAdapterDeploymentPlan(id: string): Promise<{ status: Nvfp4ParameterAdapterStatus; message: string }> { return this.controlJson(`/api/models/nvfp4/parameter-adapter/deployment-plans/${id}/confirm`, 'POST', {}) as Promise<{ status: Nvfp4ParameterAdapterStatus; message: string }> }
  async createNvfp4ParameterPlan(proposed: Record<string, number>): Promise<Nvfp4ParameterPlan> { const payload = await this.controlJson('/api/models/nvfp4/parameter-plans', 'POST', { proposed }) as { plan?: Nvfp4ParameterPlan }; if (!payload.plan) throw new Error('Parameter plan did not return a plan.'); return payload.plan }
  async confirmNvfp4ParameterPlan(id: string): Promise<Nvfp4ParameterOperation> { const payload = await this.controlJson(`/api/models/nvfp4/parameter-plans/${id}/confirm`, 'POST', {}) as { operation?: Nvfp4ParameterOperation }; if (!payload.operation) throw new Error('Parameter plan did not return an operation.'); return payload.operation }
  async createNvfp4RollbackPlan(operationId: string): Promise<Nvfp4ParameterPlan> { const payload = await this.controlJson(`/api/models/nvfp4/parameter-operations/${operationId}/rollback-plans`, 'POST', {}) as { plan?: Nvfp4ParameterPlan }; if (!payload.plan) throw new Error('Rollback plan did not return a plan.'); return payload.plan }
  async confirmNvfp4RollbackPlan(id: string): Promise<Nvfp4ParameterOperation> { const payload = await this.controlJson(`/api/models/nvfp4/parameter-rollback-plans/${id}/confirm`, 'POST', {}) as { operation?: Nvfp4ParameterOperation }; if (!payload.operation) throw new Error('Rollback plan did not return an operation.'); return payload.operation }

  async createLocalControlPlan(serviceId: string, action: LocalControlAction): Promise<LocalControlPlan> {
    return this.controlJson('/api/local-control/plans', 'POST', { serviceId, action }) as Promise<LocalControlPlan>
  }

  async confirmLocalControlPlan(planId: string): Promise<LocalControlOperation> {
    return this.controlJson(`/api/local-control/plans/${planId}/confirm`, 'POST', {}) as Promise<LocalControlOperation>
  }

  async getLocalControlOperation(operationId: string): Promise<LocalControlOperation> {
    return this.controlJson(`/api/local-control/operations/${operationId}`, 'GET') as Promise<LocalControlOperation>
  }

  async getHealthState(): Promise<ReadResult<{ status: string; timestamp: string }>> {
    return this.read('health', () => ({ status: 'healthy', timestamp: this.now().toISOString() }), async () => {
      const raw = await this.getJson('/api/health') as BackendRecord
      return { status: text(raw.status, 'unknown'), timestamp: text(raw.generatedAt, this.now().toISOString()) }
    }, () => ({ status: 'unavailable', timestamp: this.now().toISOString() }))
  }

  async getServicesState(): Promise<ReadResult<ServiceInfo[]>> {
    return this.read('services', () => clone(mockServices), async () => mapServices(await this.getJson('/api/services')), () => [])
  }

  async getSystemMetricsState(): Promise<ReadResult<SystemMetrics>> {
    return this.read('system', () => clone(mockSystemMetrics), async () => mapSystem(await this.getJson('/api/system')), unavailableSystemMetrics)
  }

  async getModelMetricsState(type: 'nvfp4' | 'vlm'): Promise<ReadResult<ModelMetrics>> {
    return this.read(`${type}Metrics`, () => clone(mockModelMetrics[type]), async () => mapMetrics(await this.getJson(`/api/models/${type}/metrics`)), unavailableModelMetrics)
  }

  async getNvfp4StartupConfigState(): Promise<ReadResult<Nvfp4StartupConfig>> {
    return this.read('nvfp4Config', () => ({ maxModelLen: null, gpuMemoryUtilization: null, maxNumSeqs: null, maxNumBatchedTokens: null, kvCacheDtype: null, prefixCaching: null, mtpTokens: null }), async () => mapNvfp4Config(await this.getJson('/api/models/nvfp4/config')))
  }

  async getRequestsState(): Promise<ReadResult<RequestRecord[]>> {
    return this.read('requests', () => clone(mockRequests), async () => mapRequests(await this.getJson('/api/requests')), () => [])
  }

  async getLogsState(service: string, lines = 200): Promise<ReadResult<LogEntry[]>> {
    const safeLines = Math.min(500, Math.max(1, Math.round(lines)))
    return this.read(`logs:${service}:${safeLines}`, () => clone(mockLogs.filter((item) => item.service === service).slice(0, safeLines)), async () => {
      return mapLogs(await this.getJson(`/api/logs?service=${encodeURIComponent(service)}&lines=${safeLines}`), service)
    }, () => [])
  }

  async getBenchmarkHistoryState(): Promise<ReadResult<BenchmarkResult[]>> {
    return this.read('benchmarks', () => [], async () => mapBenchmarkHistory(await this.getJson('/api/benchmarks')))
  }

  private async read<T>(key: string, mock: () => T, live: () => Promise<T>, unavailable: () => T = mock): Promise<ReadResult<T>> {
    const updatedAt = this.now().toISOString()
    if (this.mode === 'mock') return { data: mock(), stale: false, updatedAt }
    try {
      const result: ReadResult<T> = { data: await live(), stale: false, updatedAt }
      this.cache.set(key, result)
      return result
    } catch (error) {
      const previous = this.cache.get(key) as ReadResult<T> | undefined
      return {
        // In Live mode, never substitute demonstration data for a failed
        // request. A previous verified response may be shown as stale; the
        // first failure instead exposes an explicitly unavailable value.
        data: previous?.data ?? unavailable(),
        stale: true,
        updatedAt: previous?.updatedAt ?? updatedAt,
        error: error instanceof Error ? error.message : '读取只读 API 失败。',
      }
    }
  }

  private async getJson(path: string): Promise<unknown> {
    if (!this.fetcher) throw new Error('当前环境不支持 Fetch API。')
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`
    const response = await this.fetcher(`${this.baseUrl}${path}`, { method: 'GET', headers })
    if (!response.ok) throw new Error(`只读 API 请求失败：${response.status}`)
    return response.json()
  }

  private async controlJson(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    if (!this.fetcher) throw new Error('当前环境不支持 Fetch API。')
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await this.fetcher(`${this.baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const payload = await response.json().catch(() => ({})) as { error?: unknown; code?: unknown; requestId?: unknown }
    if (!response.ok) throw new ApiRequestError(typeof payload.error === 'string' ? payload.error : `本机控制请求失败：${response.status}`, {
      code: typeof payload.code === 'string' ? payload.code : null,
      status: response.status,
      requestId: typeof payload.requestId === 'string' ? payload.requestId : null,
    })
    return payload
  }

  // ── Setup / Connection Profile API ──

  async getSetupCapabilities(): Promise<{ capabilities: SetupCapabilities; connection: string; checkedAt: string }> {
    if (this.mode !== 'live') return {
      connection: 'not-configured',
      checkedAt: new Date().toISOString(),
      capabilities: { monitoring: 'unknown' },
    }
    return this.controlJson('/api/setup/capabilities', 'GET') as Promise<{ capabilities: SetupCapabilities; connection: string; checkedAt: string }>
  }

  async getSetupProfiles(): Promise<SetupProfilesDoc> {
    if (this.mode !== 'live') return { schemaVersion: 2, activeProfileId: null, profiles: [] }
    return this.controlJson('/api/setup/profiles', 'GET') as Promise<SetupProfilesDoc>
  }

  async createSetupProfile(req: CreateProfileRequest): Promise<CreateProfileResponse> {
    if (this.mode !== 'live') return { profile: { id: 'mock-01', displayName: req.displayName, transport: 'openssh-alias', sshAlias: req.sshAlias, hostKeyFingerprint: req.hostKeyFingerprint ?? null, verification: { status: 'unverified', verifiedAt: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
    // ── Field allowlist: only displayName, sshAlias, optional hostKeyFingerprint ──
    const body: Record<string, unknown> = { displayName: String(req.displayName ?? ''), sshAlias: String(req.sshAlias ?? '') }
    if (req.hostKeyFingerprint) body.hostKeyFingerprint = String(req.hostKeyFingerprint)
    return this.controlJson('/api/setup/profiles', 'POST', body) as Promise<CreateProfileResponse>
  }

  async verifySetupProfile(id: string): Promise<VerifyProfileResponse> {
    if (this.mode !== 'live') return { profileId: id, result: { schemaVersion: 1, checkedAt: new Date().toISOString(), connection: 'reachable', capabilities: { monitoring: 'available' } } }
    return this.controlJson(`/api/setup/profiles/${id}/verify`, 'POST', {}) as Promise<VerifyProfileResponse>
  }

  async activateSetupProfile(id: string): Promise<ActivateProfileResponse> {
    if (this.mode !== 'live') return { activeProfileId: id }
    return this.controlJson(`/api/setup/profiles/${id}/activate`, 'POST', {}) as Promise<ActivateProfileResponse>
  }
}

export const createApiClient = (options?: ApiClientOptions) => new ApiClient(options)

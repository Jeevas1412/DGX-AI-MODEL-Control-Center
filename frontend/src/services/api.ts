import type { ActivateProfileResponse, BenchmarkResult, CreateProfileRequest, CreateProfileResponse, LogEntry, ModelConfig, ModelMetrics, Nvfp4StartupConfig, RequestRecord, ServiceInfo, SetupProfilesDoc, SystemMetrics, VerifyProfileResponse } from '../types'
import { mockBenchmarkResults, mockModelConfigs } from '../mocks/data'
import { createApiClient, type CatalogModelEntry, type CatalogSearchResult, type DgxConnectionStatus, type HardwareHistoryMetric, type HardwareHistoryPoint, type HardwareHistoryRange, type HardwareSummary, type LocalControlAction, type LocalControlOperation, type LocalControlPlan, type ManagedServicePlan, type ModelServiceAdapter, type ModelServiceDraft, type ModelServicePrecheck, type ModelServiceRegistrationPlan, type ModelServiceTemplate, type Nvfp4ParameterAdapterDeploymentPlan, type Nvfp4ParameterAdapterStatus, type Nvfp4ParameterOperation, type Nvfp4ParameterPlan, type Nvfp4ParameterReview, type ReadResult, type RemoteDesktopStatus } from './api-client'

const client = createApiClient()
const readOnlyMessage = '当前为只读监控模式：此操作已禁用，未发送任何写请求。'

class ApiService {
  readonly mode = client.mode
  readonly baseUrl = client.baseUrl
  get hasAccessToken() { return client.hasAccessToken }

  setAccessToken(token: string) { client.setAccessToken(token) }

  getHealthState() { return client.getHealthState() }
  getDgxConnectionStatus(): Promise<DgxConnectionStatus> { return client.getDgxConnectionStatus() }
  getDgxConnectionStatusState(): Promise<ReadResult<DgxConnectionStatus>> { return client.getDgxConnectionStatusState() }
  getRemoteDesktopStatusState(): Promise<ReadResult<RemoteDesktopStatus>> { return client.getRemoteDesktopStatusState() }
  getHardwareSummaryState(): Promise<ReadResult<HardwareSummary>> { return client.getHardwareSummaryState() }
  getHardwareHistoryState(metric: HardwareHistoryMetric, range: HardwareHistoryRange): Promise<ReadResult<HardwareHistoryPoint[]>> { return client.getHardwareHistoryState(metric, range) }
  getServicesState(): Promise<ReadResult<ServiceInfo[]>> { return client.getServicesState() }
  getSystemMetricsState(): Promise<ReadResult<SystemMetrics>> { return client.getSystemMetricsState() }
  getModelMetricsState(type: 'nvfp4' | 'vlm'): Promise<ReadResult<ModelMetrics>> { return client.getModelMetricsState(type) }
  getNvfp4StartupConfigState(): Promise<ReadResult<Nvfp4StartupConfig>> { return client.getNvfp4StartupConfigState() }
  getRequestsState(): Promise<ReadResult<RequestRecord[]>> { return client.getRequestsState() }
  getLogsState(service: string, lines = 200): Promise<ReadResult<LogEntry[]>> { return client.getLogsState(service, lines) }

  async getHealth() { return (await client.getHealthState()).data }
  async getServices() { return (await client.getServicesState()).data }
  async getSystemMetrics() { return (await client.getSystemMetricsState()).data }
  async getModelMetrics(type: 'nvfp4' | 'vlm') { return (await client.getModelMetricsState(type)).data }
  async getRequests() { return (await client.getRequestsState()).data }
  async getLogs(service: string, lines = 200) { return (await client.getLogsState(service, lines)).data }

  getLocalControlCapabilities() { return client.getLocalControlCapabilities() }
  createLocalControlPlan(serviceId: string, action: LocalControlAction): Promise<LocalControlPlan> { return client.createLocalControlPlan(serviceId, action) }
  confirmLocalControlPlan(planId: string): Promise<LocalControlOperation> { return client.confirmLocalControlPlan(planId) }
  getLocalControlOperation(operationId: string): Promise<LocalControlOperation> { return client.getLocalControlOperation(operationId) }
  getModelCatalog(): Promise<CatalogModelEntry[]> { return client.getModelCatalog() }
  searchModelCatalog(query: string): Promise<CatalogSearchResult[]> { return client.searchModelCatalog(query) }
  addModelToCatalog(entry: CatalogSearchResult): Promise<CatalogModelEntry> { return client.addModelToCatalog(entry) }
  getModelServiceTemplates(): Promise<ModelServiceTemplate[]> { return client.getModelServiceTemplates() }
  getModelServiceAdapters(): Promise<ModelServiceAdapter[]> { return client.getModelServiceAdapters() }
  getModelServiceDrafts(): Promise<ModelServiceDraft[]> { return client.getModelServiceDrafts() }
  createModelServiceDraft(input: { catalogEntryId: string; templateId: string; displayName: string }): Promise<ModelServiceDraft> { return client.createModelServiceDraft(input) }
  precheckModelServiceDraft(id: string): Promise<ModelServicePrecheck> { return client.precheckModelServiceDraft(id) }
  createModelServiceRegistrationPlan(id: string): Promise<ModelServiceRegistrationPlan> { return client.createModelServiceRegistrationPlan(id) }
  confirmModelServiceRegistrationPlan(id: string): Promise<ModelServiceDraft> { return client.confirmModelServiceRegistrationPlan(id) }
  createManagedServicePlan(id: string, action: LocalControlAction): Promise<ManagedServicePlan> { return client.createManagedServicePlan(id, action) }
  confirmManagedServicePlan(id: string): Promise<{ status: string; message: string }> { return client.confirmManagedServicePlan(id) }
  createNvfp4ParameterReview(proposed: Record<string, number | boolean | string>): Promise<Nvfp4ParameterReview> { return client.createNvfp4ParameterReview(proposed) }
  getNvfp4ParameterAdapterStatus(): Promise<Nvfp4ParameterAdapterStatus> { return client.getNvfp4ParameterAdapterStatus() }
  createNvfp4ParameterAdapterDeploymentPlan(): Promise<Nvfp4ParameterAdapterDeploymentPlan> { return client.createNvfp4ParameterAdapterDeploymentPlan() }
  confirmNvfp4ParameterAdapterDeploymentPlan(id: string): Promise<{ status: Nvfp4ParameterAdapterStatus; message: string }> { return client.confirmNvfp4ParameterAdapterDeploymentPlan(id) }
  createNvfp4ParameterPlan(proposed: Record<string, number>): Promise<Nvfp4ParameterPlan> { return client.createNvfp4ParameterPlan(proposed) }
  confirmNvfp4ParameterPlan(id: string): Promise<Nvfp4ParameterOperation> { return client.confirmNvfp4ParameterPlan(id) }
  createNvfp4RollbackPlan(operationId: string): Promise<Nvfp4ParameterPlan> { return client.createNvfp4RollbackPlan(operationId) }
  confirmNvfp4RollbackPlan(id: string): Promise<Nvfp4ParameterOperation> { return client.confirmNvfp4RollbackPlan(id) }

  getSetupCapabilities() { return client.getSetupCapabilities() }
  getSetupProfiles(): Promise<SetupProfilesDoc> { return client.getSetupProfiles() }
  createSetupProfile(req: CreateProfileRequest): Promise<CreateProfileResponse> { return client.createSetupProfile(req) }
  verifySetupProfile(id: string): Promise<VerifyProfileResponse> { return client.verifySetupProfile(id) }
  activateSetupProfile(id: string): Promise<ActivateProfileResponse> { return client.activateSetupProfile(id) }

  async getModelConfigs(): Promise<ModelConfig[]> { return structuredClone(mockModelConfigs) }
  async getBenchmarkHistory(): Promise<BenchmarkResult[]> {
    if (this.mode === 'mock') return structuredClone(mockBenchmarkResults)
    return (await client.getBenchmarkHistoryState()).data
  }
  async runBenchmark(): Promise<BenchmarkResult> { return structuredClone(mockBenchmarkResults[0]) }

  async updateRequestParams() { return { success: false, message: readOnlyMessage } }
  async updateStartupParams() { return { success: false, message: readOnlyMessage, requiresRestart: false } }
  async applyConfig() { return { success: false, message: readOnlyMessage } }
  async rollbackConfig() { return { success: false, message: readOnlyMessage } }
  async warmup() { return { success: false, message: readOnlyMessage } }
  async stop() { return { success: false, message: readOnlyMessage } }
  async restart() { return { success: false, message: readOnlyMessage } }
}

export const api = new ApiService()
export { createApiClient }
export type { ApiMode, CatalogModelEntry, CatalogSearchResult, DgxConnectionStatus, HardwareHistoryMetric, HardwareHistoryPoint, HardwareHistoryRange, HardwareSummary, LocalControlAction, LocalControlOperation, LocalControlPlan, ManagedServicePlan, ModelServiceAdapter, ModelServiceDraft, ModelServicePrecheck, ModelServiceRegistrationPlan, ModelServiceTemplate, Nvfp4ParameterAdapterDeploymentPlan, Nvfp4ParameterAdapterStatus, Nvfp4ParameterOperation, Nvfp4ParameterPlan, Nvfp4ParameterReview, ReadResult, RemoteDesktopStatus } from './api-client'

// DGX AI Control Center - 类型定义

// 模型服务状态
export type ServiceStatus = 'running' | 'idle' | 'loading' | 'stopped' | 'restarting' | 'error' | 'offline' | 'registered' | 'adapter-unavailable';

// 模型类型
export type ModelType = 'nvfp4' | 'vlm' | 'image' | 'generic';

// 服务信息
export interface ServiceInfo {
  id: string;
  name: string;
  type: ModelType;
  status: ServiceStatus;
  /** `null` means the verified adapter did not declare a health port. */
  port: number | null;
  uptime: string;
  memoryUsage: number; // GB
  gpuMemoryUsage: number; // GB
  requestQueue: number;
  residency?: 'resident' | 'on-demand' | 'unknown';
  latency?: number;
  tokensPerSecond?: number;
  runningRequests?: number;
  /** Running model process allocation observed through the read-only DGX probe. */
  observedMemoryGiB?: number | null;
  /** Bounded startup budget from a verified launcher or a measured fixed profile. */
  estimatedMemoryGiB?: number | null;
  estimateSource?: 'configured-reservation' | 'adapter-reservation' | 'measured-profile' | null;
  /** Observed stable runtime allocation for a measured fixed profile, if available. */
  estimatedMemoryBaselineGiB?: number | null;
  /** Additional bounded allocation retained for model preheat, if available. */
  startupBufferGiB?: number | null;
  /** Built-in controls and registered adapter controls intentionally use different flows. */
  control?: 'local' | 'managed' | 'none';
  managedServiceId?: string;
  /** Actions declared by the exact, verified adapter bound to this managed service. */
  managedActions?: Array<'warmup' | 'restart' | 'stop'>;
}

export interface ModelMemoryBudget {
  source: 'linux-memavailable' | 'unavailable';
  totalGiB: number | null;
  freeGiB: number | null;
  safetyReserveGiB: number | null;
  allocatableGiB: number | null;
  /** GPU-unified memory observed in identified model-serving processes during the same snapshot. */
  observedModelMemoryGiB: number | null;
  observedModelRuntimeCount: number | null;
  /** GPU compute memory not attributable to a supported model-serving runtime. */
  observedOtherGpuComputeGiB: number | null;
}

// 系统指标
export interface SystemMetrics {
  cpuUsage: number; // percentage
  memoryTotal: number; // GB
  memoryUsed: number; // GB
  memoryAvailable: number; // GB
  gpuMemoryTotal: number; // GB
  gpuMemoryUsed: number; // GB
  gpuUtilization: number; // percentage
  gpuPowerWatts: number;
  gpuTemperatureCelsius: number;
  uptime: string;
  modelMemoryBudget?: ModelMemoryBudget;
}

// 模型指标
export interface ModelMetrics {
  ttft: number; // ms - 首 token 延迟
  tokensPerSecond: number;
  prefixCacheHitRate: number; // percentage
  mtpAcceptRate: number; // percentage
  activeRequests: number;
  queuedRequests: number;
}

export interface Nvfp4StartupConfig {
  maxModelLen: number | null;
  gpuMemoryUtilization: number | null;
  maxNumSeqs: number | null;
  maxNumBatchedTokens: number | null;
  kvCacheDtype: string | null;
  prefixCaching: boolean | null;
  mtpTokens: number | null;
}

// 请求记录
export interface RequestRecord {
  id: string;
  model: string;
  status: 'running' | 'queued' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  promptLength: number;
  outputTokens: number;
  ttft: number;
  throughput: number; // tokens/s
}

// 日志条目
export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  service: string;
  message: string;
}

// 请求级参数
export interface RequestParams {
  default_max_tokens: number;
  fast_tool_mode: boolean;
  enable_thinking_for_tools: boolean;
  request_timeout: number;
  concurrency_limit: number;
}

// 启动级参数
export interface StartupParams {
  max_model_len: number;
  kv_cache_memory: number;
  max_num_seqs: number;
  max_num_batched_tokens: number;
  mtp_tokens: number;
  prefix_caching: boolean;
  gpu_memory_utilization: number;
}

// 模型配置
export interface ModelConfig {
  type: ModelType;
  name: string;
  requestParams: RequestParams;
  startupParams: StartupParams;
  presets: ModelPreset[];
}

// 模型预设
export interface ModelPreset {
  name: string;
  description: string;
  params: Partial<RequestParams & StartupParams>;
}

// 性能测试结果
export interface BenchmarkResult {
  id: string;
  testName: string;
  timestamp: string;
  successRate: number;
  avgTTFT: number | null;
  avgThroughput: number | null;
  p50: number;
  p95: number;
  p99: number;
  peakMemory: number | null;
  errorCount: number;
  errors: string[];
  /** 数据来源：dgx-real 表示真实 DGX 压测，mock 表示前端模拟 */
  source?: 'dgx-real' | 'mock';
  /** 是否冷启动（仅长上下文测试有意义） */
  coldStart?: boolean;
  /** 输入 token 数（真实 DGX 记录） */
  inputTokens?: number;
  /** 输出 token 数（真实 DGX 记录） */
  outputTokens?: number;
}

// 测试模板
export interface TestTemplate {
  id: string;
  name: string;
  description: string;
  concurrency: number;
  promptLength: number;
}

export interface OverviewTrendPoint {
  label: string;
  latencyMs: number;
  memoryPercent: number;
}

export interface OverviewError {
  id: string;
  timestamp: string;
  service: string;
  code: '502' | '504' | 'OOM' | 'RESET';
  message: string;
}

// ── 阶段 7: 安装向导与受控切换 ──

// 向导步骤
export type WizardStep = 'connection' | 'testing' | 'fingerprint' | 'capabilities' | 'complete';

// 向导状态
export interface WizardState {
  step: WizardStep;
  /** 连接配置 */
  connection: ConnectionConfig;
  /** 测试连接结果 */
  testResult: TestConnectionResult | null;
  /** 是否已确认指纹 */
  fingerprintConfirmed: boolean;
  /** 服务器指纹 */
  serverFingerprint: string | null;
  /** 能力检查结果 */
  capabilityResults: CapabilityCheckResult[];
  /** 全局错误 */
  error: string | null;
}

// 连接配置
export interface ConnectionConfig {
  name: string;
  address: string;
  identityMethod: 'existing-key' | 'new-key';
  port: number;
}

// 连接测试结果
export interface TestConnectionResult {
  success: boolean;
  latencyMs: number;
  serverFingerprint: string;
  authMethod: string;
  message: string;
}

// 能力检查项
export interface CapabilityCheckResult {
  service: string;
  compatible: boolean;
  version: string;
  requiredVersion: string;
  note: string;
}

// ── 阶段 7: Setup API 合同类型 ──

// 连接配置
export interface ConnectionProfile {
  id: string;
  displayName: string;
  transport: 'openssh-alias';
  sshAlias: string;
  hostKeyFingerprint: string | null;
  verification: {
    status: 'unverified' | 'verified';
    verifiedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

// Setup 配置集合
export interface SetupProfilesDoc {
  schemaVersion: number;
  activeProfileId: string | null;
  profiles: ConnectionProfile[];
}

export interface ActivateProfileResponse {
  activeProfileId: string;
}

// 创建 Profile 请求
export interface CreateProfileRequest {
  displayName: string;
  sshAlias: string;
  hostKeyFingerprint?: string | null;
}

// 创建 Profile 响应
export interface CreateProfileResponse {
  profile: ConnectionProfile;
}

// 验证 Profile 响应
export interface VerifyProfileResponse {
  profileId: string;
  result: CapabilityResult;
}

// 能力旗标
export interface CapabilityResult {
  schemaVersion: number;
  checkedAt: string;
  connection: 'reachable' | 'not-configured' | 'unavailable';
  capabilities: SetupCapabilities;
}

export interface SetupCapabilities {
  monitoring: 'available' | 'unavailable' | 'unknown';
}

// 导航项
export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: string;
}

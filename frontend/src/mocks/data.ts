// 模拟数据

import {
  ServiceInfo,
  SystemMetrics,
  ModelMetrics,
  RequestRecord,
  LogEntry,
  ModelConfig,
  BenchmarkResult,
  TestTemplate,
  OverviewTrendPoint,
  OverviewError,
  ConnectionConfig,
  TestConnectionResult,
  CapabilityCheckResult,
} from '../types';

// 服务列表
export const mockServices: ServiceInfo[] = [
  {
    id: 'nvfp4-001',
    name: 'NVFP4 主模型',
    type: 'nvfp4',
    status: 'running',
    port: 8091,
    uptime: '15d 7h 32m',
    memoryUsage: 4.2,
    gpuMemoryUsage: 32.5,
    requestQueue: 3,
    residency: 'resident',
    latency: 128,
    tokensPerSecond: 34.4,
    runningRequests: 2,
  },
  {
    id: 'vlm-001',
    name: 'VLM 视觉模型',
    type: 'vlm',
    status: 'idle',
    port: 8003,
    uptime: '12d 4h 15m',
    memoryUsage: 3.8,
    gpuMemoryUsage: 28.1,
    requestQueue: 1,
    residency: 'on-demand',
    latency: 286,
    tokensPerSecond: 18.6,
    runningRequests: 0,
  },
  {
    id: 'image-001',
    name: '图像生成模型',
    type: 'image',
    status: 'error',
    port: 8188,
    uptime: '0d 0h 0m',
    memoryUsage: 0,
    gpuMemoryUsage: 0,
    requestQueue: 0,
    residency: 'on-demand',
    latency: 0,
    tokensPerSecond: 0,
    runningRequests: 0,
  },
];

// 系统指标
export const mockSystemMetrics: SystemMetrics = {
  cpuUsage: 65.2,
  memoryTotal: 128,
  memoryUsed: 86.4,
  memoryAvailable: 41.6,
  gpuMemoryTotal: 80,
  gpuMemoryUsed: 60.6,
  gpuUtilization: 68,
  gpuPowerWatts: 72,
  gpuTemperatureCelsius: 61,
  uptime: '2 天 16 小时',
};

export const mockOverviewTrends: OverviewTrendPoint[] = [
  { label: '14:00', latencyMs: 122, memoryPercent: 62 },
  { label: '14:01', latencyMs: 118, memoryPercent: 63 },
  { label: '14:02', latencyMs: 130, memoryPercent: 63 },
  { label: '14:03', latencyMs: 145, memoryPercent: 64 },
  { label: '14:04', latencyMs: 138, memoryPercent: 65 },
  { label: '14:05', latencyMs: 152, memoryPercent: 65 },
  { label: '14:06', latencyMs: 164, memoryPercent: 66 },
  { label: '14:07', latencyMs: 141, memoryPercent: 65 },
  { label: '14:08', latencyMs: 136, memoryPercent: 66 },
  { label: '14:09', latencyMs: 155, memoryPercent: 67 },
  { label: '14:10', latencyMs: 149, memoryPercent: 68 },
  { label: '14:11', latencyMs: 171, memoryPercent: 67 },
  { label: '14:12', latencyMs: 159, memoryPercent: 68 },
  { label: '14:13', latencyMs: 143, memoryPercent: 67 },
  { label: '14:14', latencyMs: 128, memoryPercent: 66 },
];

export const mockOverviewErrors: OverviewError[] = [
  { id: 'overview-error-1', timestamp: '2026-07-19T14:11:20Z', service: '图像生成', code: 'OOM', message: '显存不足，已保留错误上下文供诊断。' },
  { id: 'overview-error-2', timestamp: '2026-07-19T14:04:08Z', service: 'VLM', code: '504', message: '后端冷启动超时，代理仍可继续重试。' },
  { id: 'overview-error-3', timestamp: '2026-07-19T13:56:42Z', service: 'NVFP4', code: '502', message: '兼容代理检测到上游连接短暂重置。' },
];

// 模型指标
export const mockModelMetrics: Record<string, ModelMetrics> = {
  nvfp4: {
    ttft: 120,
    tokensPerSecond: 85.5,
    prefixCacheHitRate: 72.3,
    mtpAcceptRate: 45.8,
    activeRequests: 12,
    queuedRequests: 3,
  },
  vlm: {
    ttft: 280,
    tokensPerSecond: 42.1,
    prefixCacheHitRate: 68.5,
    mtpAcceptRate: 38.2,
    activeRequests: 5,
    queuedRequests: 1,
  },
};

// 请求记录
export const mockRequests: RequestRecord[] = [
  {
    id: 'req-001',
    model: 'NVFP4',
    status: 'running',
    startTime: '2026-07-19T13:10:00Z',
    promptLength: 120,
    outputTokens: 0,
    ttft: 115,
    throughput: 0,
  },
  {
    id: 'req-002',
    model: 'NVFP4',
    status: 'running',
    startTime: '2026-07-19T13:11:00Z',
    promptLength: 85,
    outputTokens: 0,
    ttft: 130,
    throughput: 0,
  },
  {
    id: 'req-003',
    model: 'VLM',
    status: 'queued',
    startTime: '2026-07-19T13:12:00Z',
    promptLength: 256,
    outputTokens: 0,
    ttft: 0,
    throughput: 0,
  },
  {
    id: 'req-004',
    model: 'NVFP4',
    status: 'completed',
    startTime: '2026-07-19T13:05:00Z',
    endTime: '2026-07-19T13:05:45Z',
    promptLength: 500,
    outputTokens: 1250,
    ttft: 95,
    throughput: 92.3,
  },
  {
    id: 'req-005',
    model: 'VLM',
    status: 'completed',
    startTime: '2026-07-19T13:00:00Z',
    endTime: '2026-07-19T13:02:30Z',
    promptLength: 18000,
    outputTokens: 850,
    ttft: 320,
    throughput: 38.5,
  },
];

// 日志条目
export const mockLogs: LogEntry[] = [
  {
    id: 'log-001',
    timestamp: '2026-07-19T13:12:30Z',
    level: 'info',
    service: 'nvfp4',
    message: 'Request completed: req-004, tokens=1250, throughput=92.3 tok/s',
  },
  {
    id: 'log-002',
    timestamp: '2026-07-19T13:11:15Z',
    level: 'info',
    service: 'nvfp4',
    message: 'New request received: req-002, prompt_length=85',
  },
  {
    id: 'log-003',
    timestamp: '2026-07-19T13:10:05Z',
    level: 'info',
    service: 'nvfp4',
    message: 'New request received: req-001, prompt_length=120',
  },
  {
    id: 'log-004',
    timestamp: '2026-07-19T13:08:00Z',
    level: 'warn',
    service: 'vlm',
    message: 'GPU memory usage high: 28.1/80 GB (35.1%)',
  },
  {
    id: 'log-005',
    timestamp: '2026-07-19T12:55:00Z',
    level: 'error',
    service: 'image',
    message: 'Model failed to start: CUDA out of memory',
  },
  {
    id: 'log-006',
    timestamp: '2026-07-19T12:50:00Z',
    level: 'info',
    service: 'nvfp4',
    message: 'Prefix cache hit rate: 72.3%, MTP accept rate: 45.8%',
  },
  {
    id: 'log-007',
    timestamp: '2026-07-19T12:30:00Z',
    level: 'info',
    service: 'vlm',
    message: 'Model warmed up successfully',
  },
  {
    id: 'log-008',
    timestamp: '2026-07-19T12:00:00Z',
    level: 'info',
    service: 'nvfp4',
    message: 'Service started on port 8091',
  },
  {
    id: 'log-009',
    timestamp: '2026-07-19T13:18:00Z',
    level: 'error',
    service: '8091',
    message: '502 upstream connection reset while forwarding completion request',
  },
  {
    id: 'log-010',
    timestamp: '2026-07-19T13:17:10Z',
    level: 'error',
    service: '8093',
    message: '504 gateway timeout after compatibility proxy retry window',
  },
  {
    id: 'log-011',
    timestamp: '2026-07-19T13:16:02Z',
    level: 'error',
    service: 'nvfp4',
    message: 'Tool parse failed: unable to decode structured tool call payload',
  },
  {
    id: 'log-012',
    timestamp: '2026-07-19T13:15:18Z',
    level: 'error',
    service: 'image',
    message: 'OOM: CUDA out of memory during image model warm-up',
  },
];

// 模型配置
export const mockModelConfigs: ModelConfig[] = [
  {
    type: 'nvfp4',
    name: 'NVFP4 主模型',
    requestParams: {
      default_max_tokens: 4096,
      fast_tool_mode: true,
      enable_thinking_for_tools: false,
      request_timeout: 30,
      concurrency_limit: 20,
    },
    startupParams: {
      max_model_len: 32768,
      kv_cache_memory: 0.5,
      max_num_seqs: 256,
      max_num_batched_tokens: 131072,
      mtp_tokens: 8,
      prefix_caching: true,
      gpu_memory_utilization: 0.9,
    },
    presets: [
      {
        name: '默认',
        description: '平衡性能与质量',
        params: { default_max_tokens: 4096, concurrency_limit: 20 },
      },
      {
        name: '高性能',
        description: '提高并发，降低延迟',
        params: { default_max_tokens: 2048, concurrency_limit: 50, fast_tool_mode: true },
      },
      {
        name: '长上下文',
        description: '适合长文档处理',
        params: { default_max_tokens: 8192, request_timeout: 60 },
      },
    ],
  },
  {
    type: 'vlm',
    name: 'VLM 视觉模型',
    requestParams: {
      default_max_tokens: 2048,
      fast_tool_mode: false,
      enable_thinking_for_tools: true,
      request_timeout: 45,
      concurrency_limit: 10,
    },
    startupParams: {
      max_model_len: 16384,
      kv_cache_memory: 0.4,
      max_num_seqs: 128,
      max_num_batched_tokens: 65536,
      mtp_tokens: 4,
      prefix_caching: true,
      gpu_memory_utilization: 0.85,
    },
    presets: [
      {
        name: '默认',
        description: '标准视觉推理',
        params: { default_max_tokens: 2048, concurrency_limit: 10 },
      },
      {
        name: '高精度',
        description: '提高输出质量',
        params: { default_max_tokens: 4096, request_timeout: 60 },
      },
    ],
  },
];

// 性能测试结果 — 前 4 条为真实 DGX P0~P2 单并发基线记录
export const mockBenchmarkResults: BenchmarkResult[] = [
  {
    id: 'dgx-p0',
    testName: 'P0 单发短提示（真实 DGX）',
    timestamp: '2026-07-19T15:00:00Z',
    successRate: 100,
    avgTTFT: 361.7,
    avgThroughput: 11.1,
    p50: 0,
    p95: 0,
    p99: 0,
    peakMemory: null,
    errorCount: 0,
    errors: [],
    source: 'dgx-real',
    inputTokens: 14,
    outputTokens: 4,
  },
  {
    id: 'dgx-p1',
    testName: 'P1 工具调用（真实 DGX）',
    timestamp: '2026-07-19T15:05:00Z',
    successRate: 100,
    avgTTFT: 1953.6,
    avgThroughput: 9.2,
    p50: 0,
    p95: 0,
    p99: 0,
    peakMemory: null,
    errorCount: 0,
    errors: [],
    source: 'dgx-real',
    inputTokens: 291,
    outputTokens: 18,
  },
  {
    id: 'dgx-p2-cold',
    testName: 'P2 18K 长上下文冷缓存（真实 DGX）',
    timestamp: '2026-07-19T15:20:00Z',
    successRate: 100,
    avgTTFT: 20084.7,
    avgThroughput: 0.2,
    p50: 0,
    p95: 0,
    p99: 0,
    peakMemory: null,
    errorCount: 0,
    errors: [],
    source: 'dgx-real',
    coldStart: true,
    inputTokens: 18026,
    outputTokens: 4,
  },
  {
    id: 'dgx-p2-warm',
    testName: 'P2 18K 长上下文热缓存（真实 DGX）',
    timestamp: '2026-07-19T15:25:00Z',
    successRate: 100,
    avgTTFT: 2305.0,
    avgThroughput: 1.7,
    p50: 0,
    p95: 0,
    p99: 0,
    peakMemory: null,
    errorCount: 0,
    errors: [],
    source: 'dgx-real',
    coldStart: false,
    inputTokens: 18026,
    outputTokens: 4,
  },
];

// 测试模板
export const testTemplates: TestTemplate[] = [
  { id: 'tpl-001', name: '单发短提示', description: '单次请求，短 prompt', concurrency: 1, promptLength: 100 },
  { id: 'tpl-002', name: '工具调用', description: '测试工具调用能力', concurrency: 1, promptLength: 200 },
  { id: 'tpl-003', name: '18K 长上下文', description: '测试长上下文处理能力', concurrency: 1, promptLength: 18000 },
  { id: 'tpl-004', name: '10 并发', description: '10 个并发请求', concurrency: 10, promptLength: 500 },
  { id: 'tpl-005', name: '20 并发', description: '20 个并发请求', concurrency: 20, promptLength: 500 },
  { id: 'tpl-006', name: '50 并发', description: '50 个并发请求', concurrency: 50, promptLength: 500 },
  { id: 'tpl-007', name: 'NVFP4 + VLM 同时', description: '两个模型同时运行', concurrency: 10, promptLength: 1000 },
];

// ── 阶段 7: 安装向导模拟数据 ──

/** 默认连接配置 */
export const mockDefaultConnection: ConnectionConfig = {
  name: '',
  address: '',
  identityMethod: 'existing-key',
  port: 22,
};

/** 模拟连接测试成功结果 */
export const mockTestSuccess: TestConnectionResult = {
  success: true,
  latencyMs: 48,
  serverFingerprint: 'SHA256:g7x9Kp2mNqRt5WvY8zA3bCdE6fGhJkL0MnBvCxZ1',
  authMethod: 'publickey',
  message: '连接成功，已通过 SSH 公钥认证。',
};

/** 模拟连接测试失败结果 */
export const mockTestFailure: TestConnectionResult = {
  success: false,
  latencyMs: 0,
  serverFingerprint: '',
  authMethod: '',
  message: '连接失败：无法解析主机地址或端口不可达。',
};

/** 模拟能力检查结果 */
export const mockCapabilities: CapabilityCheckResult[] = [
  { service: '文本模型服务', compatible: true, version: '2.1.0', requiredVersion: '2.0.0', note: '已登记，可进行只读监控。' },
  { service: '视觉语言模型服务', compatible: true, version: '1.8.2', requiredVersion: '1.7.0', note: '已登记，可进行只读监控。' },
  { service: '图像生成服务', compatible: true, version: '3.0.1', requiredVersion: '3.0.0', note: '按需模式启动，兼容当前控制台。' },
  { service: '模型服务控制兼容性', compatible: true, version: '1.0.0', requiredVersion: '1.0.0', note: '是否可控制取决于各服务的固定适配器。' },
  { service: '兼容接口服务', compatible: true, version: '1.5.0', requiredVersion: '1.4.0', note: '已登记，可按当前状态读取。' },
  { service: '结构化日志采集', compatible: false, version: '0.9.0', requiredVersion: '1.0.0', note: '需要升级日志采集组件。不影响核心功能。' },
];

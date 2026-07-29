const isoNow = () => new Date().toISOString();

const services = [
  {
    id: 'nvfp4',
    name: 'NVFP4',
    status: 'unknown',
    port: 8091,
    residency: 'unknown',
    uptimeSeconds: null,
  },
  {
    id: 'vlm',
    name: 'VLM',
    status: 'unknown',
    port: 8092,
    residency: 'unknown',
    uptimeSeconds: null,
  },
  {
    id: 'image',
    name: 'Image model',
    status: 'unknown',
    port: null,
    residency: 'unknown',
    uptimeSeconds: null,
  },
  {
    id: 'proxy-8093',
    name: 'API proxy',
    status: 'unknown',
    port: 8093,
    residency: 'unknown',
    uptimeSeconds: null,
  },
];

export function buildSnapshot() {
  const generatedAt = isoNow();
  return {
    generatedAt,
    source: 'placeholder',
    health: {
      status: 'degraded',
      generatedAt,
      detail: 'No DGX collector has been configured yet.',
    },
    services,
    system: {
      generatedAt,
      memoryTotalBytes: null,
      memoryAvailableBytes: null,
      gpuUtilizationPercent: null,
      gpuPowerWatts: null,
      gpuTemperatureCelsius: null,
      queueDepth: null,
      modelMemoryBudget: { source: 'unavailable', totalMiB: null, freeMiB: null, safetyReserveMiB: null, allocatableMiB: null },
    },
    metrics: {
      nvfp4: {
        generatedAt,
        ttftMs: null,
        tokensPerSecond: null,
        prefixCacheHitRate: null,
        mtpAcceptanceRate: null,
        runningRequests: null,
        queuedRequests: null,
      },
      vlm: {
        generatedAt,
        ttftMs: null,
        tokensPerSecond: null,
        prefixCacheHitRate: null,
        mtpAcceptanceRate: null,
        runningRequests: null,
        queuedRequests: null,
      },
    },
    requests: [],
    logs: [],
  };
}

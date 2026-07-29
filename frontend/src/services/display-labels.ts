/**
 * Stable, portable service labels for the product UI. API identifiers and
 * remote probe names are intentionally kept out of the primary interface.
 */
const serviceNames: Record<string, string> = {
  nvfp4: '千问3.6 27B NVFP4',
  vlm: '视觉语言模型服务',
  image: '图像生成服务',
  'proxy-8093': 'API 兼容代理',
}

const serviceKinds: Record<string, string> = {
  nvfp4: '文本推理服务',
  vlm: '视觉语言推理服务',
  image: '图像生成服务',
  'proxy-8093': '兼容接口服务',
}

// Service identifiers and model IDs stay stable for the API while the UI uses
// a portable naming rule that remains understandable in another DGX environment.
export function localizedModelName(value: string) {
  if (/^hy-mt2-30b-a3b-fp8$/i.test(value)) return '混元 MT2 30B-A3B FP8'
  if (/^(?:nvidia-)?qwen3\.6-35b-a3b-nvfp4$/i.test(value)) return '千问3.6 35B-A3B NVFP4'
  if (/^(?:nvidia-)?qwen3\.6-27b-nvfp4$/i.test(value)) return '千问3.6 27B NVFP4'
  return value
}

export function localizedServiceName(id: string, fallback: string) {
  if (serviceNames[id]) return serviceNames[id]
  return localizedModelName(fallback)
}

export function localizedServiceKind(id: string) {
  return serviceKinds[id] ?? '模型服务'
}

/**
 * Registration only says that the Control Center knows how to manage a
 * service.  Loading must be based on an observed serving process instead.
 */
export function modelLoadState(observedMemoryGiB: number | null | undefined) {
  if (typeof observedMemoryGiB === 'number') {
    return { label: '已加载', detail: '已检测到模型进程', tone: 'loaded' as const }
  }
  return { label: '未加载', detail: '未检测到模型进程', tone: 'unloaded' as const }
}

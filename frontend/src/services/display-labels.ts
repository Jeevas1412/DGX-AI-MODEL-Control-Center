/**
 * Stable, portable service labels for the product UI. API identifiers and
 * remote probe names are intentionally kept out of the primary interface.
 */
const serviceNames: Record<string, string> = {
  nvfp4: '文本模型服务 1',
  vlm: '视觉语言模型服务 1',
  image: '图像生成服务 1',
  'proxy-8093': 'API 兼容代理 1',
}

const serviceKinds: Record<string, string> = {
  nvfp4: '文本推理服务',
  vlm: '视觉语言推理服务',
  image: '图像生成服务',
  'proxy-8093': '兼容接口服务',
}

// Service identifiers stay stable for the API while the UI uses a naming rule
// that remains understandable in another DGX environment.
export function localizedServiceName(id: string, fallback: string) {
  return serviceNames[id] ?? fallback
}

export function localizedServiceKind(id: string) {
  return serviceKinds[id] ?? '模型服务'
}

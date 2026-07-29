import type { LocalControlAction } from './api'

export type ControlDisclosure = {
  actionLabel: string;
  impact: string;
  executionNote: string;
}

export function controlDisclosure(action: LocalControlAction): ControlDisclosure {
  switch (action) {
    case 'warmup':
      return {
        actionLabel: '启动 / 预热',
        impact: '确认后将通过已验证的固定适配器尝试加载或预热目标服务，并在完成后复核服务状态与资源。',
        executionNote: '当前只是在创建计划，尚未向 DGX 发送启动或预热请求。',
      }
    case 'restart':
      return {
        actionLabel: '重启',
        impact: '确认后将停止并重新启动目标服务；服务在完成健康复核前可能暂时不可用。',
        executionNote: '当前只是在创建计划，尚未向 DGX 发送重启请求。',
      }
    case 'stop':
      return {
        actionLabel: '停止',
        impact: '确认后将停止目标服务并释放其运行资源；后续需要由用户重新创建启动计划才会再次加载。',
        executionNote: '当前只是在创建计划，尚未向 DGX 发送停止请求。',
      }
  }
}

export function planExpiryLabel(expiresAt: string) {
  return new Date(expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

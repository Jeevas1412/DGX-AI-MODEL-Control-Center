import type { LocalControlAction } from './api'

export function localizedActionName(action: LocalControlAction) {
  if (action === 'warmup') return '启动 / 预热'
  if (action === 'restart') return '重启'
  return '停止'
}

export function localizedOperationPhase(phase: string) {
  if (phase === 'queued') return '等待执行'
  if (phase === 'executing') return '执行固定操作'
  if (phase === 'verifying') return '验证服务状态'
  if (phase === 'completed') return '已完成'
  if (phase === 'failed') return '未完成'
  return '操作状态更新中'
}

export function localizedServiceStatus(status: string) {
  if (status === 'running') return '运行中'
  if (status === 'idle') return '空闲'
  if (status === 'loading') return '加载中'
  if (status === 'restarting') return '重启中'
  if (status === 'stopped') return '已停止'
  if (status === 'offline') return '离线'
  if (status === 'error') return '错误'
  return '状态未知'
}

export function servicePlanSummary(serviceName: string, action: LocalControlAction) {
  if (action === 'warmup') return `将通过已登记的固定适配器启动 / 预热 ${serviceName}，并在完成后复核服务健康状态。`
  if (action === 'restart') return `将通过已登记的固定适配器重启 ${serviceName}，并在完成后复核服务健康状态。`
  return `将通过已登记的固定适配器停止 ${serviceName}，并在完成后复核服务已离线。`
}

function errorDetails(value: unknown) {
  if (typeof value === 'string') return { message: value, code: null as string | null }
  if (value && typeof value === 'object') {
    const record = value as { message?: unknown; code?: unknown }
    return {
      message: typeof record.message === 'string' ? record.message : '',
      code: typeof record.code === 'string' ? record.code : null,
    }
  }
  return { message: '', code: null as string | null }
}

export function requiresConnectionReverification(value: unknown) {
  const { message, code } = errorDetails(value)
  // A control plan is bound to the verified connection identity, capability
  // snapshot and adapter digest.  Any of these signals changing invalidates
  // the plan; surface the re-verification path instead of leaving the user
  // with a disabled "confirm" button and no explanation.
  return code === 'PROFILE_REVERIFY_REQUIRED'
    || /identity or capability evidence changed|verification is expired|identity evidence is unavailable|verified operation context does not match|active connection(?: identity)? .*changed|capability evidence .*changed|no active profile/i.test(message)
}

// The desktop UI must not surface backend implementation text in an otherwise
// Chinese control flow. Known safe failures receive an actionable translation;
// unknown failures remain intentionally generic rather than exposing scripts,
// paths, adapters, or English internals.
export function localizedRuntimeMessage(value: unknown, fallback = '操作未完成，请稍后重试。') {
  const { message } = errorDetails(value)
  if (!message) return fallback
  if (requiresConnectionReverification(value)) return '当前连接的验证记录已过期或已变化。请先重新验证连接，再创建新的操作计划。'
  if (/another local service operation is already running/i.test(message)) return '已有另一项服务操作正在执行，请等待其完成。'
  if (/control plan (is unavailable|expired)/i.test(message)) return '操作计划不可用或已失效，请重新创建计划。'
  if (/verified active ssh target is unavailable/i.test(message)) return '当前已验证连接不可用，请重新验证连接。'
  if (/verified adapter does not support this action/i.test(message)) return '当前已验证适配器未声明此操作。请刷新适配器检查；不会执行任何模型动作。'
  if (/managed service registration is required/i.test(message)) return '该服务尚未完成受控登记，暂不能创建操作计划。'
  if (/managed service startup precheck is not satisfied/i.test(message)) return '启动前检查未通过。请查看资源、队列和适配器状态后重新创建计划。'
  if (/managed service action is invalid/i.test(message)) return '服务操作无效；仅可使用该已验证适配器声明的启动或停止动作。'
  if (/managed service execution is unavailable/i.test(message)) return '当前客户端未启用受控服务执行。请在设置中确认已启用远程管理会话。'
  if (/registered adapter compatibility verification is unavailable|deployment topology is incompatible/i.test(message)) return '固定服务适配器未通过兼容性验证，未执行任何服务操作。'
  if (/registered service postcondition failed/i.test(message)) return '服务操作结束，但后置状态验证未通过；未将结果标记为成功。'
  if (/confirmed and waiting for the fixed adapter action/i.test(message)) return '已确认，正在等待固定服务适配器执行。'
  if (/operation completed and the registered postcondition was verified/i.test(message)) return '操作已完成，并已通过固定后置状态验证。'
  if (/operation did not complete/i.test(message)) return '操作未完成；未执行未登记的补救动作。'
  if (/active or queued request/i.test(message)) return '当前仍有活动请求或排队请求，服务操作已被阻止。'
  if (/内存安全前检已阻止/.test(message)) return message
  return fallback
}

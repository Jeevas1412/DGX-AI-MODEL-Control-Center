import { describe, expect, it } from 'vitest'
import { localizedActionName, localizedOperationPhase, localizedRuntimeMessage, localizedServiceStatus, requiresConnectionReverification, servicePlanSummary } from './localized-runtime'

describe('localized runtime messages', () => {
  it('translates expired connection evidence into an actionable Chinese message', () => {
    const source = 'Active connection identity or capability evidence changed. Re-run fixed read-only verification before control.'

    expect(requiresConnectionReverification(source)).toBe(true)
    expect(localizedRuntimeMessage(source)).toBe('当前连接的验证记录已过期或已变化。请先重新验证连接，再创建新的操作计划。')
  })

  it('treats a stale verified-operation context as a re-verification failure', () => {
    expect(requiresConnectionReverification('Verified operation context does not match the active plan and registered adapter.')).toBe(true)
    expect(localizedRuntimeMessage('Verified operation context does not match the active plan and registered adapter.')).toBe('当前连接的验证记录已过期或已变化。请先重新验证连接，再创建新的操作计划。')
  })

  it('uses the stable backend error code even when the message is implementation-neutral', () => {
    const error = Object.assign(new Error('Control confirmation was rejected.'), { code: 'PROFILE_REVERIFY_REQUIRED' })
    expect(requiresConnectionReverification(error)).toBe(true)
    expect(localizedRuntimeMessage(error)).toBe('当前连接的验证记录已过期或已变化。请先重新验证连接，再创建新的操作计划。')
  })

  it('keeps fixed service plans fully Chinese', () => {
    expect(servicePlanSummary('VLM', 'warmup')).toBe('将通过已登记的固定适配器启动 / 预热 VLM，并在完成后复核服务健康状态。')
    expect(servicePlanSummary('VLM', 'restart')).toBe('将通过已登记的固定适配器重启 VLM，并在完成后复核服务健康状态。')
    expect(servicePlanSummary('VLM', 'stop')).toBe('将通过已登记的固定适配器停止 VLM，并在完成后复核服务已离线。')
  })

  it('does not disclose an unknown backend implementation message', () => {
    expect(localizedRuntimeMessage('unexpected implementation detail')).toBe('操作未完成，请稍后重试。')
  })

  it('translates control labels and runtime states that otherwise reach the UI as English', () => {
    expect(localizedActionName('warmup')).toBe('启动 / 预热')
    expect(localizedOperationPhase('queued')).toBe('等待执行')
    expect(localizedOperationPhase('verifying')).toBe('验证服务状态')
    expect(localizedServiceStatus('offline')).toBe('离线')
  })
})

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type LocalControlAction, type LocalControlOperation, type LocalControlPlan, type ManagedServicePlan } from '../services/api'
import { useApiResource } from '../services/use-api-resource'
import { localizedActionName, localizedOperationPhase, localizedRuntimeMessage, requiresConnectionReverification } from '../services/localized-runtime'
import { localizedServiceKind, localizedServiceName } from '../services/display-labels'
import { controlDisclosure, planExpiryLabel } from '../services/control-disclosure'
import { mockOverviewTrends } from '../mocks/data'
import { type ModelMetrics, type ServiceInfo, type ServiceStatus, type SystemMetrics } from '../types'
import './Overview.css'

type ControlPlan = LocalControlPlan | ManagedServicePlan
type Action = { service: ServiceInfo; name: LocalControlAction; managed?: boolean; planning?: boolean; plan?: ControlPlan; operation?: LocalControlOperation; error?: string; needsConnectionReverification?: boolean } | null

function memoryLabel(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)} GiB`
}

const statusText: Record<ServiceStatus, string> = {
  running: '运行中',
  idle: '空闲',
  loading: '加载中',
  stopped: '已停止',
  restarting: '重启中',
  error: '错误',
  offline: '离线',
  registered: '已登记，按需加载',
  'adapter-unavailable': '适配器待验证',
}

const OPERATION_TIMEOUT_MS: Record<LocalControlAction, number> = {
  // Warmup may start a cold model load; this is the same registered adapter
  // timeout, not an estimate of DGX completion.
  warmup: 1_850_000,
  restart: 90_000,
  stop: 90_000,
}

function clock(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function operationProgress(operation: LocalControlOperation, now: number) {
  const limitMs = OPERATION_TIMEOUT_MS[operation.action]
  const elapsedMs = Math.max(0, now - new Date(operation.startedAt).getTime())
  const rawPercent = Math.min(95, Math.round((elapsedMs / limitMs) * 100))
  const phasePercent = operation.phase === 'queued' ? Math.max(3, rawPercent)
    : operation.phase === 'verifying' ? Math.max(92, rawPercent)
      : Math.max(8, rawPercent)
  return { elapsed: clock(elapsedMs), percent: phasePercent, overrun: elapsedMs > limitMs, limit: clock(limitMs) }
}

function makeLinePath(values: number[], width = 520, height = 150) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width
    const y = height - ((value - min) / range) * height
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
}

function TrendChart({ title, unit, values, accent }: { title: string; unit: string; values: number[]; accent: string }) {
  const path = useMemo(() => makeLinePath(values), [values])
  const latest = values[values.length - 1] ?? 0
  return (
    <section className="trend-card">
      <div className="trend-heading">
        <div><p>{title}</p><strong>{latest}{unit}</strong></div>
        <span className="trend-window">近 15 分钟</span>
      </div>
      <svg className="trend-chart" viewBox="0 0 520 180" role="img" aria-label={`${title}近十五分钟趋势`}>
        {[30, 75, 120, 165].map((y) => <line key={y} x1="0" y1={y} x2="520" y2={y} className="chart-grid" />)}
        <path d={path} className="chart-line" style={{ stroke: accent }} />
      </svg>
      <div className="trend-labels"><span>{mockOverviewTrends[0].label}</span><span>{mockOverviewTrends[mockOverviewTrends.length - 1]?.label}</span></div>
    </section>
  )
}

export default function Overview() {
  const [action, setAction] = useState<Action>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [localControlEnabled, setLocalControlEnabled] = useState(false)
  const [operationClock, setOperationClock] = useState(() => Date.now())
  const [reverifyingConnection, setReverifyingConnection] = useState(false)
  const getSystem = useCallback(() => api.getSystemMetricsState(), [])
  const getServices = useCallback(() => api.getServicesState(), [])
  const getNvfp4 = useCallback(() => api.getModelMetricsState('nvfp4'), [])
  const getHealth = useCallback(() => api.getHealthState(), [])
  const system = useApiResource<SystemMetrics>(getSystem)
  const serviceList = useApiResource<ServiceInfo[]>(getServices)
  const nvfp4 = useApiResource<ModelMetrics>(getNvfp4)
  const health = useApiResource(getHealth, 15_000)
  const systemMetrics = system.data
  const services = serviceList.data ?? []
  const nvfp4Metrics = nvfp4.data
  const loading = system.isLoading || serviceList.isLoading || nvfp4.isLoading
  const stale = system.stale || serviceList.stale || nvfp4.stale || health.stale
  const loadError = [system.error, serviceList.error, nvfp4.error, health.error].filter(Boolean).join('；') || null
  const healthStatus = health.data?.status
  const healthOk = healthStatus === 'healthy' || healthStatus === 'ok'
  const monitoringClass = health.isLoading ? 'checking' : stale ? 'offline' : healthOk ? 'online' : healthStatus === 'degraded' ? 'degraded' : 'offline'
  const monitoringLabel = health.isLoading ? '正在检查' : stale ? '数据可能过期' : healthOk ? '监控正常' : healthStatus === 'degraded' ? '部分服务不可用' : '状态未知'
  const controlsBusy = Boolean(action?.planning || action?.operation?.status === 'running')
  const actionBlocked = Boolean(action?.error)

  useEffect(() => {
    if (action?.operation?.status !== 'running') return undefined
    const timer = window.setInterval(() => setOperationClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [action?.operation?.status])

  useEffect(() => {
    let active = true
    if (api.mode === 'mock') return () => { active = false }
    void api.getLocalControlCapabilities()
      .then((capabilities) => { if (active) setLocalControlEnabled(capabilities.enabled) })
      .catch(() => { if (active) setLocalControlEnabled(false) })
    return () => { active = false }
  }, [])

  const memoryUsagePercent = useMemo(() => {
    if (!systemMetrics) return 0
    return systemMetrics.memoryTotal ? Math.round((systemMetrics.memoryUsed / systemMetrics.memoryTotal) * 100) : 0
  }, [systemMetrics])

  const gpuMemoryUsagePercent = useMemo(() => {
    if (!systemMetrics) return 0
    return systemMetrics.gpuMemoryTotal ? Math.round((systemMetrics.gpuMemoryUsed / systemMetrics.gpuMemoryTotal) * 100) : 0
  }, [systemMetrics])

  const modelMemoryBudget = systemMetrics?.modelMemoryBudget

  async function refreshAll() {
    await Promise.all([system.refresh(), serviceList.refresh(), nvfp4.refresh(), health.refresh()])
  }

  async function beginAction(service: ServiceInfo, name: LocalControlAction) {
    if (api.mode === 'mock') {
      setAction({ service, name })
      return
    }
    const managed = service.control === 'managed'
    if (managed && !service.managedServiceId) {
      setAction({ service, name, managed, error: '该服务尚未绑定已登记的受控服务记录，无法创建操作计划。' })
      return
    }
    setAction({ service, name, managed, planning: true })
    try {
      const plan = managed
        ? await api.createManagedServicePlan(service.managedServiceId!, name)
        : await api.createLocalControlPlan(service.id, name)
      setAction((current) => current?.service.id === service.id && current.name === name ? { ...current, planning: false, plan } : current)
    } catch (error) {
      setAction((current) => current?.service.id === service.id && current.name === name ? { ...current, planning: false, error: localizedRuntimeMessage(error, '无法创建操作计划。'), needsConnectionReverification: requiresConnectionReverification(error) } : current)
    }
  }

  async function confirmAction() {
    if (!action) return
    if (api.mode === 'mock') {
      setNotice(`已模拟“${localizedActionName(action.name)}”操作：${localizedServiceName(action.service.id, action.service.name)} 的真实服务未被修改。`)
      setAction(null)
      return
    }
    if (!action.plan) return
    const planId = action.plan.id
    try {
      if (action.managed) {
        const outcome = await api.confirmManagedServicePlan(planId)
        setNotice(localizedRuntimeMessage(outcome.message, '已提交固定适配器操作；请刷新服务状态确认结果。'))
        await refreshAll()
        setAction(null)
        return
      }
      const operation = await api.confirmLocalControlPlan(planId)
      setAction((current) => {
        if (!current || current.plan?.id !== planId) return current
        return { ...current, operation }
      })
      void monitorOperation(operation)
    } catch (error) {
      const needsReverification = requiresConnectionReverification(error)
      setAction((current) => current ? {
        ...current,
        // A failed confirmation must never be retried against the old plan:
        // its snapshot may no longer describe the active connection. Keep the
        // service/action so the user can re-create it after re-verification,
        // but remove the stale plan from the confirm path.
        plan: needsReverification ? undefined : current.plan,
        error: localizedRuntimeMessage(error, '无法确认操作。'),
        needsConnectionReverification: needsReverification,
      } : current)
    }
  }

  async function monitorOperation(operation: LocalControlOperation) {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000))
      try {
        const current = await api.getLocalControlOperation(operation.id)
        setAction((existing) => existing?.operation?.id === operation.id ? { ...existing, operation: current } : existing)
        if (current.status === 'succeeded' || current.status === 'failed') {
          setNotice(`${current.serviceName}：${localizedRuntimeMessage(current.message, '操作已结束，请查看最新服务状态。')}`)
          await refreshAll()
          setAction((existing) => existing?.operation?.id === operation.id ? null : existing)
          return
        }
      } catch (error) {
        setAction((existing) => existing?.operation?.id === operation.id ? { ...existing, error: localizedRuntimeMessage(error, '无法读取操作进度。') } : existing)
        return
      }
    }
    setAction((existing) => existing?.operation?.id === operation.id ? { ...existing, error: '操作状态轮询超时；请刷新页面查看最新状态。' } : existing)
  }

  async function reverifyActiveConnection() {
    setReverifyingConnection(true)
    try {
      const profiles = await api.getSetupProfiles()
      if (!profiles.activeProfileId) throw new Error('No active profile')
      await api.verifySetupProfile(profiles.activeProfileId)
      setAction(null)
      setNotice('当前连接已完成固定只读验证。请重新创建服务操作计划；此步骤不会启动模型。')
    } catch (error) {
      setAction((current) => current ? { ...current, error: localizedRuntimeMessage(error, '重新验证连接失败，请检查当前 OpenSSH 连接。') } : current)
    } finally {
      setReverifyingConnection(false)
    }
  }

  if (loading || !systemMetrics) {
    return <div className="overview-loading"><span className="loading-orb" />正在加载总览数据…</div>
  }

  return (
    <div className="overview-page">
      <header className="overview-hero">
        <div><p className="eyebrow">DGX AI 控制中心</p><h1>运行总览</h1><p>{api.mode === 'mock' ? '模拟数据模式' : localControlEnabled ? '本机受控模式：操作需创建计划并二次确认' : '监控已就绪；完成连接验证后可在设置中启用本机模型服务控制' } · 页面每 5 秒刷新</p></div>
        <div className="hero-actions"><div className="hero-status"><span className={`status-dot ${monitoringClass}`} />{monitoringLabel}</div><button className="btn btn-secondary" onClick={() => void refreshAll()} disabled={loading}>立即刷新</button></div>
      </header>

      {stale && <div className="overview-alert">部分接口暂不可用，已保留最后一次有效数据。{loadError ? ` ${loadError}` : ''}</div>}
      {notice && <div className="overview-notice"><span>{notice}</span><button onClick={() => setNotice(null)}>关闭</button></div>}

      <section className="overview-metrics" aria-label="系统指标">
        <article className="overview-metric"><span>系统内存</span><strong>{memoryUsagePercent}%</strong><small>{systemMetrics.memoryAvailable} GB 可用 / {systemMetrics.memoryTotal} GB</small></article>
        <article className="overview-metric"><span>GPU 利用率</span><strong>{systemMetrics.gpuUtilization}%</strong><small>显存 {gpuMemoryUsagePercent}% · {systemMetrics.gpuMemoryUsed} / {systemMetrics.gpuMemoryTotal} GB</small></article>
        <article className="overview-metric"><span>GPU 功耗</span><strong>{systemMetrics.gpuPowerWatts} W</strong><small>温度 {systemMetrics.gpuTemperatureCelsius} °C</small></article>
        <article className="overview-metric"><span>活动请求</span><strong>{nvfp4Metrics?.activeRequests ?? 0}</strong><small>队列 {nvfp4Metrics?.queuedRequests ?? 0} · 运行 {systemMetrics.uptime}</small></article>
      </section>

      {modelMemoryBudget && modelMemoryBudget.freeGiB !== null && modelMemoryBudget.allocatableGiB !== null && (
        <section className="model-memory-plan" aria-label="模型内存启动评估">
          <div>
            <p className="eyebrow">资源评估</p>
            <h2>系统资源余量</h2>
            <p>用于评估当前是否有足够系统资源加载新的模型服务。安全预留会为操作系统、驱动、缓存与短时波动保留空间；已观测到的模型进程占用会单独显示，不会被误认为“未加载”。</p>
          </div>
          <dl>
            <div><dt>系统可用资源</dt><dd>{memoryLabel(modelMemoryBudget.freeGiB)}</dd></div>
            <div><dt>系统安全预留</dt><dd>{memoryLabel(modelMemoryBudget.safetyReserveGiB)}</dd></div>
            <div><dt>可安全分配资源</dt><dd>{memoryLabel(modelMemoryBudget.allocatableGiB)}</dd></div>
            <div><dt>系统资源总量</dt><dd>{memoryLabel(modelMemoryBudget.totalGiB)}</dd></div>
            {modelMemoryBudget.observedModelMemoryGiB !== null && <div><dt>已观测模型进程</dt><dd>{memoryLabel(modelMemoryBudget.observedModelMemoryGiB)}{modelMemoryBudget.observedModelRuntimeCount ? ` · ${modelMemoryBudget.observedModelRuntimeCount} 个运行时` : ''}</dd></div>}
          </dl>
        </section>
      )}

      <section className="section-heading"><div><p className="eyebrow">服务</p><h2>模型服务状态</h2></div><span>状态演示：<i className="state-chip loading">加载</i><i className="state-chip idle">空闲</i><i className="state-chip error">错误</i><i className="state-chip offline">离线</i></span></section>
      <section className="service-grid">
        {services.map((service) => (
          <article className={`overview-service status-${service.status}`} key={service.id}>
            <div className="service-topline"><span className={`state-dot ${service.status}`} /><span className="service-port">{service.port === null ? '无固定端口' : `:${service.port}`}</span></div>
            <h3>{localizedServiceName(service.id, service.name)}</h3>
            <p className="service-status-text">{localizedServiceKind(service.id)} · {statusText[service.status]} · {service.residency === 'resident' ? '常驻' : '按需加载'}</p>
            <dl className="service-stat-grid">
              <div><dt>运行时间</dt><dd>{service.uptime}</dd></div><div><dt>TTFT</dt><dd>{service.latency ? `${service.latency} ms` : '—'}</dd></div>
              <div><dt>吞吐</dt><dd>{service.tokensPerSecond ? `${service.tokensPerSecond} tok/s` : '—'}</dd></div><div><dt>请求</dt><dd>{service.runningRequests ?? 0} / {service.requestQueue}</dd></div>
              <div><dt>实际占用</dt><dd>{service.observedMemoryGiB === null || service.observedMemoryGiB === undefined ? '—' : `${memoryLabel(service.observedMemoryGiB)}（进程观察）`}</dd></div>
              <div><dt>预计占用</dt><dd>{service.estimatedMemoryGiB === null || service.estimatedMemoryGiB === undefined ? '—' : `${memoryLabel(service.estimatedMemoryGiB)}（配置预留）`}</dd></div>
              {service.estimatedMemoryGiB !== null && service.estimatedMemoryGiB !== undefined && modelMemoryBudget?.allocatableGiB !== null && modelMemoryBudget?.allocatableGiB !== undefined && (
                <>
                  <div className="memory-explanation"><dt>安全分配</dt><dd>系统可用 {memoryLabel(modelMemoryBudget.freeGiB)} − 系统安全预留 {memoryLabel(modelMemoryBudget.safetyReserveGiB)} = 可安全分配 {memoryLabel(modelMemoryBudget.allocatableGiB)}。</dd></div>
                  <div className={`memory-advice ${service.estimatedMemoryGiB <= modelMemoryBudget.allocatableGiB ? 'safe' : 'unsafe'}`}><dt>启动评估</dt><dd>{service.estimatedMemoryGiB <= modelMemoryBudget.allocatableGiB ? '预计占用未超过可安全分配' : `${memoryLabel(service.estimatedMemoryGiB)} − ${memoryLabel(modelMemoryBudget.allocatableGiB)} = 预计缺口 ${memoryLabel(service.estimatedMemoryGiB - modelMemoryBudget.allocatableGiB)}`}</dd></div>
                  <div className="memory-footnote"><dt>说明</dt><dd>模型的启动、停止与重启只会在本客户端由用户创建计划并二次确认后执行。系统安全预留用于驱动、缓存及瞬时峰值，不代表任何服务会自动获得或占用该资源。</dd></div>
                </>
              )}
            </dl>
            {service.control === 'managed'
              ? <div className="service-actions managed-service-actions">
                <button disabled={api.mode === 'live' && (controlsBusy || !service.managedActions?.includes('warmup'))} onClick={() => void beginAction(service, 'warmup')}>启动 / 预热</button>
                <button disabled={api.mode === 'live' && (controlsBusy || !service.managedActions?.includes('restart'))} onClick={() => void beginAction(service, 'restart')}>重启</button>
                <button className="danger" disabled={api.mode === 'live' && (controlsBusy || !service.managedActions?.includes('stop'))} onClick={() => void beginAction(service, 'stop')}>停止</button>
                <p>{service.managedActions?.length ? '仅开放已验证固定适配器声明的动作。每次操作都会先创建计划，再由用户确认执行。' : '当前未读到可验证的适配器动作，控制保持禁用。'}</p>
              </div>
              : <div className="service-actions"><button disabled={api.mode === 'live' && (!localControlEnabled || controlsBusy)} onClick={() => void beginAction(service, 'warmup')}>启动 / 预热</button><button disabled={api.mode === 'live' && (!localControlEnabled || controlsBusy)} onClick={() => void beginAction(service, 'restart')}>重启</button><button className="danger" disabled={api.mode === 'live' && (!localControlEnabled || controlsBusy)} onClick={() => void beginAction(service, 'stop')}>停止</button></div>}
          </article>
        ))}
      </section>

      <section className="trend-grid">
        <TrendChart title="首 Token 延迟" unit=" ms" values={mockOverviewTrends.map((point) => point.latencyMs)} accent="var(--accent-primary)" />
        <TrendChart title="统一内存占用" unit="%" values={mockOverviewTrends.map((point) => point.memoryPercent)} accent="var(--accent-secondary)" />
      </section>

      {action && <div className="simulation-backdrop" role="presentation"><section className="simulation-dialog" role="dialog" aria-modal="true" aria-label="服务操作确认"><p className="eyebrow">{api.mode === 'mock' ? '仅模拟操作' : '操作待确认'}</p><h2>{api.mode === 'mock' ? '确认模拟操作' : '确认服务操作'}</h2>{api.mode === 'mock' ? <p>将模拟对“{localizedServiceName(action.service.id, action.service.name)}”执行“{localizedActionName(action.name)}”。不会发送 SSH、Docker 或模型控制命令。</p> : action.planning ? <section className="operation-disclosure" aria-live="polite"><strong>正在创建受控操作计划</strong><p>正在读取当前状态、资源与适配器条件。此阶段不会向 DGX 发送启动、停止或重启请求。</p></section> : action.plan ? (() => { const disclosure = controlDisclosure(action.name); return <section className="operation-disclosure" aria-live="polite"><strong>计划已创建，等待您的确认</strong><dl><div><dt>目标服务</dt><dd>{localizedServiceName(action.service.id, action.service.name)}</dd></div><div><dt>计划动作</dt><dd>{disclosure.actionLabel}</dd></div><div><dt>风险级别</dt><dd>{action.plan.risk === 'high' ? '高' : '中'}</dd></div><div><dt>计划失效</dt><dd>{planExpiryLabel(action.plan.expiresAt)}</dd></div></dl><p>{disclosure.executionNote}</p><p>{disclosure.impact}</p><p>{action.plan.requiresIdle ? '执行前仍会确认目标服务没有活动连接；NVFP4 还会检查请求与队列。' : '确认后将由本机后台执行已验证固定动作并复核结果。'}</p><p>失败不会自动重试；执行中会显示真实阶段和已用时间，不以超时上限伪造完成倒计时。</p></section> })() : <p className={action.error?.startsWith('内存安全前检') ? 'overview-alert' : ''}>{action.error ?? '无法创建操作计划。'}</p>}{action.needsConnectionReverification && <p className="overview-alert" role="alert">当前操作计划已失效。请先重新验证连接，验证完成后再重新创建计划。</p>}{action.operation && (action.operation.status === 'running' ? (() => { const progress = operationProgress(action.operation, operationClock); return <section className="operation-progress" aria-live="polite"><div className="operation-progress-heading"><strong>正在{action.operation.phase === 'verifying' ? '验证服务状态' : '执行固定操作'}</strong><span>{progress.overrun ? '超过等待上限，仍在等待适配器结果' : `已耗时 ${progress.elapsed}`}</span></div><div className="operation-progress-track" role="progressbar" aria-label="操作进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div><div className="operation-progress-meta"><span>等待上限 {progress.limit}</span><span>{progress.overrun ? '请保持此页面打开或稍后刷新状态' : '上限不是预计完成时间'}</span></div><p>{localizedRuntimeMessage(action.operation.message, '正在执行固定服务操作。')}</p></section> })() : <p><strong>{localizedOperationPhase(action.operation.phase)}</strong>：{localizedRuntimeMessage(action.operation.message, '操作已结束，请查看服务状态。')}</p>)}{action.error && action.plan && <p className="overview-alert">{action.error}</p>}<div><button className="btn btn-secondary" onClick={() => setAction(null)} disabled={action.operation?.status === 'running'}>{action.operation?.status === 'running' ? '执行中' : '取消'}</button>{action.needsConnectionReverification && <button className="btn btn-primary" disabled={reverifyingConnection} onClick={() => void reverifyActiveConnection()}>{reverifyingConnection ? '重新验证中…' : '重新验证连接'}</button>}<button className="btn btn-primary" onClick={() => { if (actionBlocked && !action.needsConnectionReverification) { void beginAction(action.service, action.name) } else { void confirmAction() } }} disabled={Boolean(action.planning || !action.plan || action.operation || action.needsConnectionReverification)}>{api.mode === 'mock' ? '确认模拟' : actionBlocked ? action.needsConnectionReverification ? '等待重新验证' : '重新创建计划' : action.operation ? '已提交' : '确认并执行'}</button></div></section></div>}
    </div>
  )
}

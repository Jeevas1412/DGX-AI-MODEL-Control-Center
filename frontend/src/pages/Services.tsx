import { useCallback } from 'react'
import { api } from '../services/api'
import { localizedServiceName } from '../services/display-labels'
import { localizedRuntimeMessage, localizedServiceStatus } from '../services/localized-runtime'
import { useApiResource } from '../services/use-api-resource'
import './Services.css'

export default function Services() {
  const loadServices = useCallback(() => api.getServicesState(), [])
  const { data: services, isLoading, stale, error } = useApiResource(loadServices, 15_000)

  if (isLoading && !services) return <PageState icon="⏳" title="加载中" subtitle="正在读取服务状态。" />
  if (error && !services) return <PageState icon="❌" title="加载失败" subtitle={localizedRuntimeMessage(error, '读取服务状态失败。')} />
  if (stale && !services?.length) return <PageState icon="📡" title="状态过期" subtitle="最近一次请求失败，无缓存数据可用。" />

  const items = services ?? []

  return (
    <div className="services-page">
      <header className="services-header">
        <p className="eyebrow">服务</p>
        <h2>服务状态</h2>
        <p className="subtitle">已登记 DGX 服务的实时状态。{stale ? ' 数据可能过期。' : ''}</p>
        {stale && <div className="services-stale-bar">⚠ 数据可能过期 — 上次成功读取后请求失败，当前显示的是缓存值。</div>}
      </header>

      {!items.length ? (
        <PageState icon="📭" title="无已登记服务" subtitle="尚未发现 DGX 服务或后端暂不可用。" />
      ) : (
        <div className="services-grid">
          {items.map((svc) => {
            const statusCls = svc.status === 'running' ? 'svc-running' : svc.status === 'idle' ? 'svc-idle' : svc.status === 'error' || svc.status === 'offline' ? 'svc-error' : 'svc-unknown'
            return (
              <div key={svc.id} className={`services-card ${statusCls}`}>
                <div className="services-card-header">
                  <span className={`services-status-dot ${svc.status}`} />
                  <strong>{localizedServiceName(svc.id, svc.name)}</strong>
                  <span className={`services-badge badge-${svc.status}`}>{localizedServiceStatus(svc.status)}</span>
                </div>
                <div className="services-card-body">
                  <div className="services-stat"><span>端口</span><strong className="mono">{svc.port}</strong></div>
                  <div className="services-stat"><span>运行时长</span><strong>{svc.uptime}</strong></div>
                  <div className="services-stat"><span>队列</span><strong>{svc.requestQueue}</strong></div>
                  {svc.residency && <div className="services-stat"><span>常驻</span><strong>{svc.residency === 'resident' ? '常驻' : '按需'}</strong></div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PageState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="page-state">
      <span className="page-state-icon">{icon}</span>
      <h3>{title}</h3>
      <p className="text-secondary">{subtitle}</p>
    </div>
  )
}

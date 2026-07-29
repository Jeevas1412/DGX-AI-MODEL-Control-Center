import { useCallback, useMemo, useState } from 'react'
import { api } from '../services/api'
import { localizedRuntimeMessage } from '../services/localized-runtime'
import { useApiResource } from '../services/use-api-resource'
import { mockRequests } from '../mocks/data'
import { type RequestRecord } from '../types'
import './Requests.css'

const filters: Array<{ id: 'all' | RequestRecord['status']; label: string }> = [
  { id: 'all', label: '全部' }, { id: 'running', label: '运行中' }, { id: 'queued', label: '排队中' }, { id: 'completed', label: '已完成' }, { id: 'failed', label: '失败' },
]

const labels: Record<RequestRecord['status'], string> = { running: '运行中', queued: '排队中', completed: '已完成', failed: '失败' }

export default function Requests() {
  const [simulatedRequests, setSimulatedRequests] = useState<RequestRecord[]>(mockRequests)
  const [filter, setFilter] = useState<'all' | RequestRecord['status']>('all')
  const [cancelTarget, setCancelTarget] = useState<RequestRecord | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const getRequests = useCallback(() => api.getRequestsState(), [])
  const requestState = useApiResource<RequestRecord[]>(getRequests)
  const requests = api.mode === 'mock' ? simulatedRequests : requestState.data ?? []
  const visible = useMemo(() => filter === 'all' ? requests : requests.filter((request) => request.status === filter), [filter, requests])
  const requestErrorText = localizedRuntimeMessage(requestState.error, '已保留最后一次有效数据。')

  function confirmCancel() {
    if (!cancelTarget) return
    setSimulatedRequests((previous) => previous.map((request) => request.id === cancelTarget.id ? { ...request, status: 'failed', endTime: new Date().toISOString() } : request))
    setNotice(`已模拟取消 ${cancelTarget.id}；没有向真实服务发送取消请求。`)
    setCancelTarget(null)
  }

  return <div className="requests-page">
    <header className="requests-header"><div><p className="eyebrow">请求监控</p><h2>请求与队列</h2><p className="subtitle">{api.mode === 'mock' ? '当前为模拟请求列表，取消操作不会影响 DGX。' : 'DGX 只读 API 模式：仅显示可用请求快照，取消操作已禁用。'}</p></div><div className="request-summary"><span>{requests.filter((request) => request.status === 'running').length} 运行</span><span>{requests.filter((request) => request.status === 'queued').length} 排队</span><button className="btn btn-secondary btn-sm" onClick={() => void requestState.refresh()} disabled={requestState.isLoading}>立即刷新</button></div></header>
    {api.mode === 'live' && requestState.stale && <div className="requests-notice">请求快照可能过期：{requestErrorText}</div>}
    {notice && <div className="requests-notice"><span>{notice}</span><button onClick={() => setNotice(null)}>关闭</button></div>}
    <nav className="request-filters" aria-label="请求状态筛选">{filters.map((item) => <button key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>{item.label}<small>{item.id === 'all' ? requests.length : requests.filter((request) => request.status === item.id).length}</small></button>)}</nav>
    <div className="table-container requests-table"><table className="table"><thead><tr><th>请求 ID</th><th>模型</th><th>状态</th><th>提示 Token</th><th>输出 Token</th><th>TTFT</th><th>吞吐</th><th>持续时间</th><th>操作</th></tr></thead><tbody>{visible.map((request) => <tr key={request.id}><td className="mono">{request.id}</td><td>{request.model}</td><td><span className={`badge status-${request.status}`}>{labels[request.status]}</span></td><td>{request.promptLength}</td><td>{request.outputTokens || '—'}</td><td>{request.ttft ? `${request.ttft} ms` : '—'}</td><td>{request.throughput ? `${request.throughput.toFixed(1)} tok/s` : '—'}</td><td>{request.endTime ? `${Math.max(1, Math.round((new Date(request.endTime).getTime() - new Date(request.startTime).getTime()) / 1000))} s` : '进行中'}</td><td>{(request.status === 'running' || request.status === 'queued') ? <button className="btn btn-danger btn-sm" disabled={api.mode === 'live'} onClick={() => setCancelTarget(request)}>{api.mode === 'live' ? '取消已禁用' : '模拟取消'}</button> : '—'}</td></tr>)}</tbody></table>{visible.length === 0 && <p className="empty-state">{api.mode === 'mock' ? '当前筛选条件下没有模拟请求。' : 'DGX 当前未提供可展示的请求快照。'}</p>}</div>
    {cancelTarget && <div className="simulation-backdrop" role="presentation"><section className="simulation-dialog" role="dialog" aria-modal="true"><p className="eyebrow">仅模拟操作</p><h2>模拟取消请求</h2><p>将把 {cancelTarget.id} 标记为失败。不会调用真实 API 或取消模型推理。</p><div><button className="btn btn-secondary" onClick={() => setCancelTarget(null)}>返回</button><button className="btn btn-danger" onClick={confirmCancel}>确认模拟取消</button></div></section></div>}
  </div>
}

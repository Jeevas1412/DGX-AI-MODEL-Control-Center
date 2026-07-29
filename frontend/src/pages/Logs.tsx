import { useCallback, useMemo, useState } from 'react'
import { api } from '../services/api'
import { localizedRuntimeMessage } from '../services/localized-runtime'
import { useApiResource } from '../services/use-api-resource'
import { mockLogs } from '../mocks/data'
import { localizedServiceName } from '../services/display-labels'
import type { ServiceInfo } from '../types'
import { type LogEntry } from '../types'
import './Logs.css'

const levels = ['all', 'info', 'warn', 'error'] as const

function isHighlighted(message: string) { return /(502|504|oom|connection reset|tool parse|工具解析)/i.test(message) }

export default function Logs() {
  const [service, setService] = useState('nvfp4')
  const [level, setLevel] = useState<typeof levels[number]>('all')
  const [query, setQuery] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [paused, setPaused] = useState(false)
  const loadLogs = useCallback(() => api.getLogsState(service, 200), [service])
  const logState = useApiResource<LogEntry[]>(loadLogs)
  const serviceState = useApiResource<ServiceInfo[]>(useCallback(() => api.getServicesState(), []), 30_000)
  const logs = api.mode === 'mock' ? mockLogs : logState.data ?? []
  const selectableServices = serviceState.data ?? []
  const serviceLabel = (id: string) => {
    const item = selectableServices.find((candidate) => candidate.id === id)
    return item ? `${localizedServiceName(item.id, item.name)}（端口 ${item.port}）` : id
  }
  const visible = useMemo(() => logs.filter((log) => (log.service === service) && (level === 'all' || log.level === level) && (`${log.service} ${log.message}`.toLowerCase().includes(query.toLowerCase()))), [logs, service, level, query])
  const logErrorText = localizedRuntimeMessage(logState.error, '已保留最后一次有效数据。')

  function exportLogs() {
    const blob = new Blob([visible.map((log) => `${log.timestamp} [${log.level.toUpperCase()}] ${log.service} ${log.message}`).join('\n')], { type: 'text/plain' })
    const anchor = document.createElement('a'); const url = URL.createObjectURL(blob); anchor.href = url; anchor.download = api.mode === 'mock' ? 'dgx-simulated-logs.txt' : `dgx-readonly-${service}-logs.txt`; anchor.click(); URL.revokeObjectURL(url)
  }

  return <div className="logs-page">
    <header className="logs-header"><div><p className="eyebrow">日志诊断</p><h2>日志与错误诊断</h2><p className="subtitle">{api.mode === 'mock' ? '当前为演示数据；自动滚动和暂停只影响本页面。' : '每次仅读取已登记服务的允许日志源；服务名称与端口不会作为独立选项混用。'}</p></div><div className="log-live-state"><span className={paused ? 'paused-dot' : 'live-dot'} />{paused ? '已暂停' : '自动滚动中'}</div></header>
    {api.mode === 'live' && logState.stale && <div className="logs-notice">日志可能过期：{logErrorText}</div>}
    <section className="logs-controls"><label>服务<select value={service} onChange={(event) => setService(event.target.value)}>{selectableServices.map((item) => <option key={item.id} value={item.id}>{serviceLabel(item.id)}</option>)}</select></label><label>级别<select value={level} onChange={(event) => setLevel(event.target.value as typeof levels[number])}>{levels.map((item) => <option key={item} value={item}>{item === 'all' ? '全部级别' : item.toUpperCase()}</option>)}</select></label><label className="search-field">搜索<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="错误码、服务或文本" /></label><button className="btn btn-secondary" onClick={() => void logState.refresh()} disabled={logState.isLoading}>刷新</button><button className="btn btn-secondary" onClick={() => setAutoScroll((value) => !value)}>{autoScroll ? '关闭自动滚动' : '开启自动滚动'}</button><button className="btn btn-secondary" onClick={() => setPaused((value) => !value)}>{paused ? '继续' : '暂停'}</button><button className="btn btn-secondary" onClick={exportLogs}>导出</button></section>
    <section className="log-summary"><article><strong>{visible.length}</strong><span>匹配日志</span></article><article><strong>{visible.filter((log) => log.level === 'error').length}</strong><span>错误</span></article><article><strong>{visible.filter((log) => isHighlighted(log.message)).length}</strong><span>重点标记</span></article><time>刷新于 {logState.updatedAt ? new Date(logState.updatedAt).toLocaleTimeString('zh-CN') : '—'}</time></section>
    <section className="log-list" aria-live={paused ? 'off' : 'polite'}>{visible.map((log: LogEntry) => <article key={log.id} className={`log-entry log-${log.level} ${isHighlighted(log.message) ? 'highlighted' : ''}`}><div className="log-header"><time className="mono">{new Date(log.timestamp).toLocaleString('zh-CN')}</time><span className={`badge badge-${log.level}`}>{log.level.toUpperCase()}</span><span className="badge badge-info">{serviceLabel(log.service)}</span>{isHighlighted(log.message) && <span className="diagnostic-flag">重点错误</span>}</div><p>{log.message}</p></article>)}{visible.length === 0 && <p className="empty-state">{api.mode === 'mock' ? '没有匹配的演示日志。' : '当前日志源没有可展示的记录。'}</p>}</section>
  </div>
}

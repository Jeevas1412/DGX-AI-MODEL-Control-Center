import { useCallback, useMemo, useState } from 'react'
import { api } from '../services/api'
import { localizedServiceName } from '../services/display-labels'
import { useApiResource } from '../services/use-api-resource'
import type { ServiceInfo } from '../types'
import './Benchmark.css'

type ValidationTemplate = {
  id: string
  name: string
  impact: string
  prerequisites: string
  result: string
}

const templates: ValidationTemplate[] = [
  { id: 'connectivity', name: '连通性检查', impact: '只读取当前服务健康状态，不发送推理请求。', prerequisites: '已验证 DGX 连接与已登记服务。', result: '确认服务端点是否可访问。' },
  { id: 'single-request', name: '单请求响应检查', impact: '将发送一条最小推理请求；需要该服务提供已验证的测试适配器。', prerequisites: '目标服务运行中，且已配置测试适配器。', result: '记录一次请求是否完成与基础响应时间。' },
  { id: 'short-latency', name: '短提示延迟检查', impact: '将发送少量短请求；需要用户查看计划并确认。', prerequisites: '目标服务运行中，且已配置测试适配器。', result: '记录短请求延迟，不作为跨环境性能排名。' },
  { id: 'light-concurrency', name: '轻量并发检查', impact: '将发送受限并发请求；必须单独授权并在达到停止条件时终止。', prerequisites: '目标服务运行中、空闲且已配置受控测试适配器。', result: '确认小并发下是否稳定，不执行压测。' },
]

export default function Benchmark() {
  const servicesState = useApiResource<ServiceInfo[]>(useCallback(() => api.getServicesState(), []), 15_000)
  const [selectedService, setSelectedService] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [checkingConnectivity, setCheckingConnectivity] = useState(false)
  const services = servicesState.data ?? []
  const eligible = useMemo(() => services.filter((service) => service.status === 'running' || service.status === 'idle'), [services])
  const selected = eligible.find((service) => service.id === selectedService)

  async function runConnectivityCheck() {
    if (!selected) return
    setCheckingConnectivity(true)
    try {
      const state = await api.getServicesState()
      if (state.stale) throw new Error('当前只能读取到缓存状态，不能证明服务当前可访问。')
      const current = state.data.find((service) => service.id === selected.id)
      if (!current) throw new Error('Selected service is no longer registered.')
      setNotice(`只读连通性检查完成：${localizedServiceName(current.id, current.name)} 当前状态为“${current.status}”。未发送推理请求，未启动或停止模型。`)
    } catch (error) {
      setNotice(`只读连通性检查失败：${error instanceof Error ? error.message : '无法读取当前服务状态。'} 未执行任何模型操作。`)
    } finally {
      setCheckingConnectivity(false)
    }
  }

  return <div className="benchmark-page">
    <header className="benchmark-header"><div><p className="eyebrow">模型验证</p><h2>模型验收测试</h2><p className="subtitle">这里不展示历史实验或模拟性能成绩。测试必须针对当前已连接、已加载且具备可验证端点的服务单独创建计划。</p></div><button className="btn btn-secondary" onClick={() => void servicesState.refresh()} disabled={servicesState.isLoading}>{servicesState.isLoading ? '正在刷新…' : '刷新服务状态'}</button></header>
    {notice && <div className="overview-notice"><span>{notice}</span><button onClick={() => setNotice(null)}>关闭</button></div>}
    <section className="benchmark-panel">
      <h3>选择测试对象</h3>
      <label className="form-label" htmlFor="benchmark-service">已加载且可观察的服务</label>
      <select id="benchmark-service" className="form-select" value={selectedService} onChange={(event) => setSelectedService(event.target.value)}><option value="">请选择服务</option>{eligible.map((service) => <option key={service.id} value={service.id}>{localizedServiceName(service.id, service.name)}（端口 {service.port}）</option>)}</select>
      {!servicesState.isLoading && eligible.length === 0 && <div className="overview-alert">当前没有已加载且可观察的服务。请先在“运行总览”中由用户创建并确认服务操作计划；本页面不会自动启动模型。</div>}
      {selected && <p className="settings-hint">当前选择：{localizedServiceName(selected.id, selected.name)}。状态：{selected.status === 'running' ? '运行中' : '空闲'}；端点：{selected.port}。</p>}
    </section>
    <section className="benchmark-panel"><p className="eyebrow">可移植测试模板</p><h3>选择测试类型</h3><p className="subtitle">连通性检查可立即执行且只读取服务状态。其余模板需要与目标模型绑定的受控测试适配器；当前未提供时不会伪造“运行测试”或写入历史结果。</p><div className="test-template-grid">{templates.map((template) => { const isConnectivity = template.id === 'connectivity'; return <article className="test-template-card" key={template.id}><h4>{template.name}</h4><dl><div><dt>前置条件</dt><dd>{template.prerequisites}</dd></div><div><dt>资源影响</dt><dd>{template.impact}</dd></div><div><dt>结果含义</dt><dd>{template.result}</dd></div></dl><button className="btn btn-secondary" disabled={!isConnectivity || !selected || checkingConnectivity} onClick={isConnectivity ? () => void runConnectivityCheck() : undefined}>{isConnectivity ? (checkingConnectivity ? '正在检查…' : '运行只读检查') : '等待测试适配器'}</button></article> })}</div></section>
    <section className="benchmark-panel"><h3>当前状态</h3><p>未保存、未展示旧生产实验结果。待服务具备可验证测试适配器后，流程将是：用户选择服务和模板 → 页面展示请求类型、资源影响与停止条件 → 用户确认 → 执行 → 仅保存到当前连接资料和当前模型标识下的结果。</p></section>
  </div>
}

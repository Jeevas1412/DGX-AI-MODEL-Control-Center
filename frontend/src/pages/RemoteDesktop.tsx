import { useCallback } from 'react'
import { api, type RemoteDesktopStatus } from '../services/api'
import { useApiResource } from '../services/use-api-resource'
import './RemoteDesktop.css'

const stateText: Record<RemoteDesktopStatus['state'], string> = {
  ready: '已就绪',
  'requires-admin-bootstrap': '需要管理员部署',
  'externally-managed': '由外部管理',
  unsupported: '当前环境不支持',
  conflict: '检测到冲突',
  unreachable: '无法读取状态',
  'not-configured': '尚未部署',
}

function valueText(value: string) {
  const text: Record<string, string> = {
    active: '运行中', inactive: '未运行', absent: '未安装', unknown: '未检测',
    listening: '正在监听', 'not-listening': '未监听', required: '已要求', 'not-required': '未要求',
    'product-managed': '产品受管', external: '外部管理', 'not-configured': '尚未配置',
  }
  return text[value] ?? value
}

export default function RemoteDesktop() {
  const load = useCallback(() => api.getRemoteDesktopStatusState(), [])
  const status = useApiResource(load, 30_000)
  const data = status.data
  const state = data?.state ?? 'unreachable'

  return <div className="remote-desktop-page">
    <header className="remote-desktop-header">
      <p className="eyebrow">远程访问</p>
      <h2>DGX 远程桌面</h2>
      <p className="subtitle">通过已验证的 SSH 连接部署和打开 DGX 的受保护 RDP 会话。默认只使用本机 SSH 隧道，不暴露局域网端口。</p>
    </header>

    <section className={`remote-desktop-state state-${state}`}>
      <div>
        <p className="eyebrow">部署状态</p>
        <h3>{status.isLoading ? '正在读取状态…' : stateText[state]}</h3>
        <p>{data?.nextStep ?? '无法读取远程桌面状态；不会自动执行修复。'}</p>
      </div>
      <button className="btn btn-secondary" onClick={status.refresh} disabled={status.isLoading}>刷新状态</button>
    </section>

    <section className="remote-desktop-details" aria-label="远程桌面状态详情">
      <div><span>远程桌面服务</span><strong>{valueText(data?.service ?? 'unknown')}</strong></div>
      <div><span>RDP 监听</span><strong>{valueText(data?.listener ?? 'unknown')}</strong></div>
      <div><span>NLA 身份验证</span><strong>{valueText(data?.nla ?? 'unknown')}</strong></div>
      <div><span>管理归属</span><strong>{valueText(data?.management ?? 'unknown')}</strong></div>
    </section>

    <section className="remote-desktop-flow">
      <p className="eyebrow">受控工作流</p>
      <h3>部署后通过本机隧道打开</h3>
      <ol>
        <li>固定只读预检：识别现有 GNOME 远程桌面、监听状态与 NLA，而不改写任何配置。</li>
        <li>创建部署计划并二次确认：仅允许产品登记的固定适配器，不接受任意命令或脚本。</li>
        <li>在需要 Linux 管理员权限时由用户本机完成授权；控制中心不会保存 Linux 密码或 sudo 密码。</li>
        <li>生成独立的 RDP 凭据并安全保存于 Windows；打开时建立仅绑定 127.0.0.1 的 SSH 隧道后调用远程桌面客户端。</li>
      </ol>
      <p className="remote-desktop-note">当前为基础能力阶段：尚未部署、生成凭据或启动远程桌面服务。后续按钮只会在固定预检、计划与权限边界完成后启用。</p>
    </section>
  </div>
}

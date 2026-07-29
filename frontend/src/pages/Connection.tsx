import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'
import { localizedRuntimeMessage } from '../services/localized-runtime'
import type { ConnectionProfile } from '../types'
import { useDesktopPreferences } from '../services/desktop-preferences'
import './Connection.css'

export default function Connection() {
  const desktop = useDesktopPreferences()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [activatingId, setActivatingId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getSetupProfiles()
      .then(
      (doc) => {
        setProfiles(doc.profiles)
        setActiveProfileId(doc.activeProfileId)
        setLoading(false)
      },
      (err) => { setError(err instanceof Error ? err.message : '加载失败'); setLoading(false) },
    )
  }, [])

  const activate = async (profile: ConnectionProfile) => {
    setActivatingId(profile.id)
    setError(null)
    try {
      const result = await api.activateSetupProfile(profile.id)
      setActiveProfileId(result.activeProfileId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法设为当前连接')
    } finally {
      setActivatingId(null)
    }
  }

  const toggleReadOnlySession = async () => {
    setError(null)
    try {
      await desktop.update({ remoteReadOnlySessionEnabled: !desktop.prefs.remoteReadOnlySessionEnabled })
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法更新只读会话设置')
    }
  }

  useEffect(() => { load() }, [load])

  if (loading) return <PageState icon="⏳" title="加载中" subtitle="正在读取连接配置与能力状态。" />
  if (error) return <PageState icon="⚠️" title="加载失败" subtitle={localizedRuntimeMessage(error, '读取连接资料失败。')} action="重试" onAction={load} />
  if (!profiles.length) return (
    <PageState icon="🔌" title="未配置连接" subtitle="请先完成首次运行向导以连接 DGX。"
      action="打开设置向导" onAction={() => window.location.hash = '/setup'} />
  )

  return (
    <div className="connection-page">
      <header className="connection-header">
        <p className="eyebrow">连接</p>
        <h2>DGX 连接状态</h2>
        <p className="subtitle">管理本机保存的 OpenSSH 连接资料与只读数据会话。服务健康和模型控制在各自功能页显示。</p>
      </header>

      <section className="connection-profiles">
        <div className="section-title"><div><p className="eyebrow">连接资料</p><h3>连接配置 ({profiles.length})</h3></div></div>
        <div className="connection-profile-grid">
          {profiles.map((p) => {
            const isActive = p.id === activeProfileId
            const isVerified = p.verification?.status === 'verified'
            return <div key={p.id} className={`connection-profile-card ${isActive ? 'active' : ''}`}>
              <strong>{p.displayName}{isActive ? ' · 当前' : ''}</strong>
              <span className="mono">别名：{p.sshAlias}</span>
              <small>传输：OpenSSH · {new Date(p.updatedAt).toLocaleDateString('zh-CN')}</small>
              <small className={isVerified ? 'connection-verified' : 'connection-unverified'}>
                {isVerified ? `已验证${p.verification.verifiedAt ? ` · ${new Date(p.verification.verifiedAt).toLocaleString('zh-CN')}` : ''}` : '未验证：不能设为当前连接'}
              </small>
              {!isActive && <button className="btn btn-secondary btn-sm" disabled={!isVerified || activatingId === p.id} onClick={() => activate(p)}>
                {activatingId === p.id ? '设置中…' : '设为当前'}
              </button>}
            </div>
          })}
        </div>
      </section>

      <section className="connection-capabilities">
        <div className="section-title"><div><p className="eyebrow">数据访问会话</p><h3>DGX 数据访问会话</h3></div></div>
        <p className="subtitle">默认关闭。启用后，仅允许此桌面客户端通过当前且已验证的连接读取 DGX 数据。服务状态请在“总览”查看；模型控制请在“设置”管理。</p>
        <button className="btn btn-secondary" disabled={!desktop.available || !activeProfileId || desktop.loading} onClick={() => void toggleReadOnlySession()}>
          {desktop.prefs.remoteReadOnlySessionEnabled ? '关闭 DGX 数据访问' : '启用 DGX 数据访问'}
        </button>
        {!activeProfileId && <small className="connection-unverified">请先选择一个已验证的当前连接。</small>}
        {!desktop.available && <small className="connection-unverified">此开关仅在桌面应用中可用。</small>}
      </section>

      <div className="connection-footer">
        <button className="btn btn-secondary" onClick={() => window.location.hash = '/setup'}>管理连接配置</button>
        <button className="btn btn-secondary" onClick={load}>刷新连接资料</button>
      </div>
    </div>
  )
}

/* ── Reusable state component ── */
function PageState({ icon, title, subtitle, action, onAction }: { icon: string; title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return (
    <div className="page-state">
      <span className="page-state-icon">{icon}</span>
      <h3>{title}</h3>
      <p className="text-secondary">{subtitle}</p>
      {action && onAction && <button className="btn btn-primary" onClick={onAction}>{action}</button>}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'
import { localizedRuntimeMessage } from '../services/localized-runtime'
import { useApiResource } from '../services/use-api-resource'
import { useDesktopPreferences, useDesktopRuntime, type ShortcutState, type Theme } from '../services/desktop-preferences'
import { useLanguage, type Locale } from '../i18n/LanguageContext'
import './Settings.css'

/* ── Helpers ── */
function timeAgo(iso: string, t: ReturnType<typeof import('../i18n/strings').getStrings>) {
  if (!iso) return '—'
  const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (diff < 5) return t.settings.timeJustNow
  if (diff < 60) return `${diff}${t.settings.timeSeconds}`
  if (diff < 3600) return `${Math.floor(diff / 60)}${t.settings.timeMinutes}`
  return `${Math.floor(diff / 3600)}${t.settings.timeHours}`
}

/* ── Shortcut item ── */
function ShortcutRow({ label, hint, state, onAction, t }: { label: string; hint: string; state: ShortcutState; onAction: () => void; t: ReturnType<typeof import('../i18n/strings').getStrings> }) {
  const derivedLabel = state.status === 'created' ? t.settings.shortcutStatusCreated
    : state.status === 'loading' ? t.settings.shortcutStatusProcessing
    : state.status === 'unsupported' ? t.settings.shortcutStatusUnsupported
    : state.status === 'denied' ? t.settings.shortcutStatusDenied
    : state.status === 'failed' ? t.settings.shortcutStatusFailed
    : ''
  const ok = state.status === 'created'
  const isStatus = state.status === 'created' || state.status === 'unsupported' || state.status === 'denied' || state.status === 'failed'
  return (
    <div className="settings-shortcut-item">
      <div className="settings-shortcut-info"><strong>{label}</strong><small>{hint}</small></div>
      <div className="settings-shortcut-action">
        {isStatus ? (
          <span className={ok ? 'settings-shortcut-ok' : state.status === 'unsupported' ? 'settings-shortcut-unsupported' : state.status === 'denied' ? 'settings-shortcut-denied' : 'settings-shortcut-failed'}>
            {ok ? '✓ ' : ''}{derivedLabel}
          </span>
        ) : (
          <button className="btn btn-secondary btn-sm" disabled={state.status === 'loading'} onClick={onAction}>
            {state.status === 'loading' ? derivedLabel : t.settings.shortcutCreate}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Main Settings ── */
export default function Settings() {
  const { locale, setLocale, t } = useLanguage()
  const { prefs, loading: prefsLoading, error: preferencesError, available: desktopAvailable, update, applyTheme } = useDesktopPreferences()
  const { runtime } = useDesktopRuntime()

  const loadHealth = useCallback(() => api.getHealthState(), [])
  const health = useApiResource(loadHealth, 15_000)
  const mode = api.mode
  const healthStatus = health.data?.status ?? '—'
  const isHealthy = healthStatus === 'healthy' || healthStatus === 'ok'
  const isFailed = !health.isLoading && health.error

  const [accessToken, setAccessToken] = useState('')
  const [tokenStored, setTokenStored] = useState(api.hasAccessToken)

  // Shortcut states — real when desktop IPC available
  const [desktopShortcut, setDesktopShortcut] = useState<ShortcutState>({ status: 'idle', message: '' })
  const [taskbarPin, setTaskbarPin] = useState<ShortcutState>({ status: 'idle', message: '' })
  const [startPin, setStartPin] = useState<ShortcutState>({ status: 'idle', message: '' })

  // Initialize shortcut states from runtime
  useEffect(() => {
    if (!desktopAvailable || !runtime) return
    const support = runtime.shortcutSupport
    if (support === 'full' || support === 'desktop-only') setDesktopShortcut({ status: 'idle', message: '' })
    else setDesktopShortcut({ status: 'unsupported', message: t.settings.shortcutStatusUnsupported })
    if (support === 'full') { setTaskbarPin({ status: 'idle', message: '' }); setStartPin({ status: 'idle', message: '' }) }
    else { setTaskbarPin({ status: 'unsupported', message: t.settings.shortcutStatusUnsupported }); setStartPin({ status: 'unsupported', message: t.settings.shortcutStatusUnsupported }) }
  }, [desktopAvailable, runtime])

  // ── Theme ──
  const handleThemeToggle = async () => {
    const next: Theme = prefs.theme === 'dark' ? 'light' : 'dark'
    if (desktopAvailable) {
      try { await update({ theme: next }) } catch { return }
    }
    applyTheme(next)
  }

  // ── Language ──
  const handleLangChange = async (l: Locale) => {
    setLocale(l)
    if (desktopAvailable) {
      try { await update({ language: l }) } catch { /* locale still applied in-memory */ }
    }
  }

  // ── Background ──
  const handleBgToggle = async () => {
    if (!desktopAvailable) return
    try {
      await update({ keepRunningWhenWindowClosed: !prefs.keepRunningWhenWindowClosed })
    } catch { /* error shown by hook */ }
  }

  const handleControlToggle = async () => {
    if (!desktopAvailable || !prefs.remoteReadOnlySessionEnabled) return
    const next = !prefs.remoteControlSessionEnabled
    if (next && !window.confirm(t.settings.controlsConfirm)) return
    try {
      await update({ remoteControlSessionEnabled: next })
    } catch { /* error shown by hook */ }
  }

  // ── Shortcuts ──
  const requestShortcut = async (key: 'desktop' | 'taskbar' | 'start') => {
    const setter = key === 'desktop' ? setDesktopShortcut : key === 'taskbar' ? setTaskbarPin : setStartPin
    if (!desktopAvailable) { setter({ status: 'unsupported', message: t.settings.bgUnavailable }); return }
    setter({ status: 'loading', message: '' })
    const support = runtime?.shortcutSupport ?? 'none'
    if (key === 'desktop' && (support === 'full' || support === 'desktop-only')) {
      try {
        const result = await window.dgxDesktop?.createDesktopShortcut()
        if (result?.status === 'created') setter({ status: 'created', message: result.message })
        else setter({ status: result?.status === 'unsupported' ? 'unsupported' : 'failed', message: result?.message ?? t.settings.shortcutStatusFailed })
      } catch (error) {
        setter({ status: 'failed', message: localizedRuntimeMessage(error instanceof Error ? error.message : null, t.settings.shortcutStatusFailed) })
      }
    } else {
      setter({ status: 'unsupported', message: key === 'desktop' ? t.settings.shortcutStatusUnsupported : 'Windows 不提供由应用直接固定到任务栏或开始菜单的通用接口；请在应用运行后使用系统菜单固定。' })
    }
  }

  return (
    <div className="page-container settings-page">
      <div className="page-header">
        <h2>{t.settings.title}</h2>
        <p className="subtitle">{t.settings.subtitle}</p>
      </div>
      {preferencesError && <div className="health-error-bar" role="alert">⚠ {localizedRuntimeMessage(preferencesError, '桌面偏好未能保存；当前界面状态不代表已持久化。')}</div>}

      <div className="settings-grid">
        {/* ── Connection Status ── */}
        <section className="settings-card full-width">
          <div className="card-title-row">
            <h3 className="card-title">{t.settings.connectionStatus}</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => health.refresh()} disabled={health.isLoading}>{health.isLoading ? t.settings.checking : t.settings.manualCheck}</button>
          </div>
          <div className="health-grid">
            <article className="health-card"><span className="health-label">{t.settings.apiAddress}</span><strong className="health-value">{api.baseUrl}</strong><small>{mode === 'mock' ? t.settings.mockData : t.settings.liveData}</small></article>
            <article className={`health-card ${isHealthy ? 'health-ok' : isFailed ? 'health-bad' : health.isLoading ? 'health-checking' : 'health-unknown'}`}><span className="health-label">{t.settings.healthStatus}<span className={`health-dot ${isHealthy ? 'dot-ok' : isFailed ? 'dot-bad' : 'dot-checking'}`} /></span><strong className="health-value">{health.isLoading ? t.settings.checking : isFailed ? t.settings.unreachable : isHealthy ? t.settings.healthy : healthStatus}</strong><small>{t.settings.every15s}</small></article>
            <article className="health-card"><span className="health-label">{t.settings.lastCheck}</span><strong className="health-value">{timeAgo(health.updatedAt, t)}</strong><small>{health.stale ? '⚠ ' + t.settings.stale : health.isLoading ? '…' : t.settings.ok}</small></article>
          </div>
          {health.stale && !health.isLoading && <div className="health-stale-bar">⚠ {t.settings.stale}<button className="btn btn-sm btn-secondary" onClick={() => health.refresh()}>{t.settings.retry}</button></div>}
          {isFailed && <div className="health-error-bar">⚠ {localizedRuntimeMessage(health.error, t.settings.unreachable)}</div>}
        </section>

        {/* ── Controlled Operations ── */}
        <section className="settings-card full-width">
          <h3 className="card-title">{t.settings.controls}</h3>
          <div className="settings-form">
            <div className="form-group toggle-group">
              <label className="toggle-label">
                <span className="toggle-text"><span className="toggle-title">{t.settings.controlsToggle}</span><span className="toggle-description">{t.settings.controlsDesc}</span></span>
                <div className="toggle-switch">
                  <input type="checkbox" checked={prefs.remoteControlSessionEnabled} disabled={!desktopAvailable || !prefs.remoteReadOnlySessionEnabled} onChange={handleControlToggle} />
                  <span className="toggle-slider" />
                </div>
              </label>
            </div>
          </div>
          <div className="settings-status-bar">
            <span className={`settings-status-dot ${desktopAvailable && prefs.remoteControlSessionEnabled ? 'dot-ok' : 'dot-unknown'}`} />
            <span className="text-secondary" style={{ fontSize: '0.7rem' }}>
              {!desktopAvailable ? t.settings.bgUnavailable : !prefs.remoteReadOnlySessionEnabled ? t.settings.controlsNeedReadOnly : prefs.remoteControlSessionEnabled ? t.settings.controlsEnabled : t.settings.controlsDisabled}
            </span>
          </div>
        </section>

        {/* ── Appearance & Language ── */}
        <section className="settings-card full-width">
          <h3 className="card-title">{t.settings.appearance}</h3>
          <div className="settings-form">
            <div className="form-group toggle-group">
              <label className="toggle-label">
                <span className="toggle-text"><span className="toggle-title">{t.settings.theme}</span><span className="toggle-description">{prefs.theme === 'dark' ? t.settings.themeDark : t.settings.themeLight}</span></span>
                <button className="btn btn-secondary btn-sm" onClick={handleThemeToggle} disabled={prefsLoading}>{prefs.theme === 'dark' ? t.settings.switchDark : t.settings.switchLight}</button>
              </label>
            </div>
            <div className="form-group toggle-group">
              <label className="toggle-label">
                <span className="toggle-text"><span className="toggle-title">{t.settings.language}</span><span className="toggle-description">{locale === 'zh-CN' ? t.settings.langZh : t.settings.langEn}</span></span>
                <select className="form-select" value={locale} onChange={(e) => handleLangChange(e.target.value as Locale)}>
                  <option value="zh-CN">{t.settings.langZh}</option>
                  <option value="en-US">{t.settings.langEn}</option>
                </select>
              </label>
            </div>
          </div>
          {!desktopAvailable && <p className="settings-hint" style={{ color: 'var(--warning)' }}>⚠ {t.settings.desktopUnavailable}</p>}
          {desktopAvailable && <p className="settings-hint">{t.settings.theme} & {t.settings.language.toLowerCase()} — {t.settings.restartRestore}</p>}
        </section>

        {/* ── Background Running ── */}
        <section className="settings-card full-width">
          <h3 className="card-title">{t.settings.background}</h3>
          <div className="settings-form">
            <div className="form-group toggle-group">
              <label className="toggle-label">
                <span className="toggle-text"><span className="toggle-title">{t.settings.bgToggle}</span><span className="toggle-description">{t.settings.bgDesc}</span></span>
                <div className="toggle-switch">
                  <input type="checkbox" checked={prefs.keepRunningWhenWindowClosed} disabled={!desktopAvailable} onChange={handleBgToggle} />
                  <span className="toggle-slider" />
                </div>
              </label>
            </div>
          </div>
          <div className="settings-status-bar">
            <span className={`settings-status-dot ${desktopAvailable ? (prefs.keepRunningWhenWindowClosed ? 'dot-ok' : 'dot-unknown') : 'dot-unknown'}`} />
            <span className="text-secondary" style={{ fontSize: '0.7rem' }}>
              {!desktopAvailable ? t.settings.bgUnavailable : prefs.keepRunningWhenWindowClosed ? t.settings.bgEnabled : t.settings.bgDisabled}
            </span>
          </div>
          {!desktopAvailable && <p className="settings-hint">{t.settings.bgDesktopUnavailable}</p>}
        </section>

        {/* ── Shortcuts ── */}
        <section className="settings-card full-width">
          <h3 className="card-title">{t.settings.shortcuts}</h3>
          <div className="settings-shortcut-grid">
            <ShortcutRow label={desktopAvailable ? t.settings.shortcutDesktop : t.settings.shortcutDesktop + ' (' + t.settings.shortcutStatusUnavailable + ')'} hint={t.settings.shortcutDesktopHint} state={desktopAvailable ? desktopShortcut : { status: 'unsupported', message: t.settings.bgUnavailable }} onAction={() => requestShortcut('desktop')} t={t} />
            <ShortcutRow label={t.settings.shortcutTaskbar} hint={t.settings.shortcutTaskbarHint} state={taskbarPin} onAction={() => requestShortcut('taskbar')} t={t} />
            <ShortcutRow label={t.settings.shortcutStart} hint={t.settings.shortcutStartHint} state={startPin} onAction={() => requestShortcut('start')} t={t} />
          </div>
          <p className="settings-hint">{desktopShortcut.message || (desktopAvailable ? '“创建桌面快捷方式”会实际写入当前 Windows 用户桌面。任务栏和开始菜单固定需通过 Windows 系统菜单完成。' : t.settings.shortcutDesktopUnavailable)}</p>
        </section>

        {/* ── LAN API token ── */}
        <section className="settings-card full-width" aria-labelledby="api-access-token-title">
          <h3 id="api-access-token-title" className="card-title">局域网访问令牌</h3>
          <p className="settings-hint">此令牌只保护控制中心向受信任局域网暴露时的本机 API，不会读取或保护 SSH 私钥、DGX 密码或模型权重。当前桌面直连模式不需要令牌；仅使用局域网网页访问时才需在浏览器客户端输入。</p>
          <div className="settings-form">
            <div className="form-group"><label className="form-label" htmlFor="api-access-token">局域网网页访问令牌</label><input id="api-access-token" type="password" autoComplete="off" className="form-input" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="仅在启用局域网网页访问时输入" /><p className="form-description">关闭局域网访问后，该令牌不会用于本桌面客户端；如怀疑泄露，请在局域网服务端轮换令牌并清除本客户端保存值。</p></div>
            <div className="token-actions"><button className="btn btn-primary" onClick={() => { api.setAccessToken(accessToken); setAccessToken(''); setTokenStored(api.hasAccessToken); void health.refresh() }} disabled={!accessToken.trim()}>{t.settings.tokenSave}</button><button className="btn btn-secondary" onClick={() => { api.setAccessToken(''); setAccessToken(''); setTokenStored(false) }} disabled={!tokenStored}>{t.settings.tokenClear}</button></div>
          </div>
        </section>

        {/* ── System Info ── */}
        <section className="settings-card full-width">
          <h3 className="card-title">{t.settings.systemInfo}</h3>
          <div className="system-info-grid">
            <div><span className="info-label">{t.settings.runMode}</span><strong className={mode === 'mock' ? 'text-warning' : 'text-accent'}>{mode === 'mock' ? t.settings.mock : t.settings.live}</strong></div>
            <div><span className="info-label">操作边界</span><strong>{desktopAvailable && prefs.remoteControlSessionEnabled ? '本机受控操作已启用' : '只读监控'}</strong></div>
            <div><span className="info-label">{t.settings.dataSource}</span><strong>{mode === 'mock' ? t.settings.mockData : t.settings.liveData}</strong></div>
          </div>
          <p className="settings-hint">{t.settings.safetyNote}</p>
        </section>
      </div>
    </div>
  )
}

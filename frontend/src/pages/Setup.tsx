import { useEffect, useState, type ReactElement } from 'react'
import {
  type WizardStep,
  type ConnectionConfig,
  type ConnectionProfile,
  type CreateProfileRequest,
  type CapabilityResult,
} from '../types'
import {
  mockDefaultConnection,
  mockTestSuccess,
  mockTestFailure,
  mockCapabilities,
} from '../mocks/data'
import { api } from '../services/api'
import { localizedRuntimeMessage } from '../services/localized-runtime'
import { initialState, transition } from './SetupStateMachine'
import { useDesktopRuntime } from '../services/desktop-preferences'
import './Setup.css'

/* ── Step labels ── */
const STEPS: { id: WizardStep; label: string; num: number }[] = [
  { id: 'connection', label: '连接信息', num: 1 },
  { id: 'testing', label: '测试连接', num: 2 },
  { id: 'fingerprint', label: '能力确认', num: 3 },
  { id: 'capabilities', label: '能力检查', num: 4 },
  { id: 'complete', label: '完成', num: 5 },
]

function stepIndex(step: WizardStep): number {
  return STEPS.findIndex(({ id }) => id === step)
}

const isLive = api.mode === 'live'

export function shouldShowProtectedLanNotice({ desktopChannel, loading, hostname }: { desktopChannel: boolean; loading: boolean; hostname: string }) {
  return !desktopChannel && !loading && hostname !== '127.0.0.1' && hostname !== 'localhost'
}

/* ── Protected LAN notice ── */
function ProtectedLanNotice() {
  return (
    <div className="wizard-form-banner wizard-form-banner-warn">
      <strong>受保护的局域网配置</strong>
      <p className="text-secondary">
        此页面可创建、验证并启用 OpenSSH 别名资料。请先在 Settings 填入访问令牌；页面不会读取私钥、密码或 SSH 配置文件，也不能控制服务或模型。
      </p>
    </div>
  )
}

/* ── Live connection form ── */
function LiveConnectionForm({
  onNext,
  onSaveError,
  onProfilesLoadError,
  onProfilesRetry,
  unavailableError,
  saveError,
}: {
  onNext: (profileId: string) => void
  onSaveError: (msg: string) => void
  onProfilesLoadError: (msg: string) => void
  onProfilesRetry: () => void
  unavailableError: string | null
  saveError: string | null
}) {
  const [displayName, setDisplayName] = useState('')
  const [sshAlias, setSshAlias] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [saving, setSaving] = useState(false)
  const [existingProfiles, setExistingProfiles] = useState<ConnectionProfile[] | null>(null)

  useEffect(() => {
    api.getSetupProfiles().then(
      (doc) => setExistingProfiles(doc.profiles),
      (err) => onProfilesLoadError(err instanceof Error ? err.message : '无法读取已有配置'),
    )
  }, [])

  const saveAndVerify = async () => {
    setSaving(true)
    try {
      const req: CreateProfileRequest = { displayName: displayName.trim(), sshAlias: sshAlias.trim() }
      if (fingerprint.trim()) req.hostKeyFingerprint = fingerprint.trim()
      const { profile } = await api.createSetupProfile(req)
      onNext(profile.id)
    } catch (err) {
      onSaveError(err instanceof Error ? err.message : '保存配置失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSelectProfile = async (profile: ConnectionProfile) => {
    setSaving(true)
    try {
      onNext(profile.id)
    } catch (err) {
      onSaveError(err instanceof Error ? err.message : '选择配置失败')
    } finally {
      setSaving(false)
    }
  }

  if (unavailableError) {
    return (
      <div className="wizard-form-wrapper">
        <div className="wizard-form-banner wizard-form-banner-warn">
          <strong>API 暂不可用</strong>
          <span>{localizedRuntimeMessage(unavailableError, '暂时无法读取本机接口。')}下方表单仅供预览，不会保存。</span>
        </div>
        <NewProfileForm
          displayName={displayName} sshAlias={sshAlias} fingerprint={fingerprint}
          onDisplayName={setDisplayName} onSshAlias={setSshAlias} onFingerprint={setFingerprint}
          onSave={() => {}}
          saving={false}
          readOnly
        />
        <div className="wizard-actions">
          <button className="btn btn-secondary" onClick={onProfilesRetry}>重新尝试</button>
        </div>
      </div>
    )
  }

  const saveErrorBanner = saveError && (
    <div className="wizard-form-banner wizard-form-banner-warn">
      <strong>保存配置失败</strong>
      <span>{localizedRuntimeMessage(saveError, '未能保存连接资料。')}未创建资料，也不会进入连接验证。</span>
    </div>
  )

  if (existingProfiles && existingProfiles.length > 0) {
    return (
      <div className="wizard-capabilities">
        {saveErrorBanner}
        <h3>已有连接配置</h3>
        <p className="text-secondary">已配置 {existingProfiles.length} 个连接，选择一个验证或创建新的。</p>
        <ul className="wizard-cap-list">
          {existingProfiles.map((p) => (
            <li key={p.id} className="wizard-cap-ok" role="button" tabIndex={0}
              onClick={() => handleSelectProfile(p)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSelectProfile(p) }}>
              <span className="wizard-cap-icon">{'\u2714'}</span>
              <div>
                <strong>{p.displayName}</strong>
                <small>别名：{p.sshAlias} · 传输：OpenSSH</small>
              </div>
              <button className="btn btn-primary btn-sm" disabled={saving}>验证</button>
            </li>
          ))}
        </ul>
        <details className="wizard-new-form-toggle">
          <summary>新建连接配置</summary>
          <NewProfileForm displayName={displayName} sshAlias={sshAlias} fingerprint={fingerprint}
            onDisplayName={setDisplayName} onSshAlias={setSshAlias} onFingerprint={setFingerprint}
            onSave={saveAndVerify} saving={saving} />
        </details>
      </div>
    )
  }

  return (
    <div className="wizard-form-wrapper">
      {saveErrorBanner}
      <NewProfileForm displayName={displayName} sshAlias={sshAlias} fingerprint={fingerprint}
        onDisplayName={setDisplayName} onSshAlias={setSshAlias} onFingerprint={setFingerprint}
        onSave={saveAndVerify} saving={saving} />
    </div>
  )
}

function NewProfileForm({
  displayName, sshAlias, fingerprint,
  onDisplayName, onSshAlias, onFingerprint,
  onSave, saving, readOnly = false,
}: {
  displayName: string; sshAlias: string; fingerprint: string
  onDisplayName: (v: string) => void; onSshAlias: (v: string) => void; onFingerprint: (v: string) => void
  onSave: () => void; saving: boolean; readOnly?: boolean
}) {
  const valid = displayName.trim().length > 0 && sshAlias.trim().length > 0
  const aliasOk = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(sshAlias.trim())
  return (
    <form className="wizard-form" onSubmit={(e) => { e.preventDefault(); if (valid && aliasOk && !readOnly) onSave() }}>
      <div className="wizard-form-group">
        <label htmlFor="wiz-name">显示名称</label>
        <input id="wiz-name" type="text" placeholder="例：我的 DGX Spark" maxLength={64} disabled={readOnly}
          value={displayName} onChange={(e) => onDisplayName(e.target.value)} />
        <small>本机显示用的别名，不影响连接。</small>
      </div>

      <div className="wizard-form-group">
        <label htmlFor="wiz-alias">OpenSSH 别名</label>
        <input id="wiz-alias" type="text" placeholder="例：dgx-home" maxLength={64} disabled={readOnly}
          value={sshAlias} onChange={(e) => onSshAlias(e.target.value)} />
        <small>在 Windows OpenSSH 配置中设置的 Host 别名。仅允许字母、数字、点、下划线、短横线。</small>
        {sshAlias.trim() && !aliasOk && <em className="text-warning">别名格式无效：必须以字母或数字开头，仅含 A-Za-z0-9._-</em>}
      </div>

      <div className="wizard-form-group">
        <label htmlFor="wiz-fp">主机指纹（可选）</label>
        <input id="wiz-fp" type="text" placeholder="SHA256:..." maxLength={128} disabled={readOnly}
          value={fingerprint} onChange={(e) => onFingerprint(e.target.value)} />
        <small>可选填写 SSH 主机指纹。连接验证时会与当前 Windows OpenSSH 已信任的主机指纹比对；不一致时不会通过验证。</small>
      </div>

      <p className="wizard-hint" style={{ margin: 0, fontSize: '0.65rem', color: 'var(--text-muted)' }}>
        请先在 Windows OpenSSH（~/.ssh/config）中配置好对应的 Host 别名。控制中心不接触您的私钥、密码或 SSH 配置文件。
      </p>

      <div className="wizard-actions">
        <span className="wizard-hint mock-hint">{isLive ? '受保护连接模式' : '模拟模式'}</span>
        <button type="submit" className="btn btn-primary" disabled={!valid || !aliasOk || saving || readOnly}>
          {saving ? '保存中…' : '保存并验证'}
        </button>
      </div>
    </form>
  )
}

/* ── Live verification step ── */
function LiveVerifyStep({ profileId, onResult, onError }: { profileId: string; onResult: (r: CapabilityResult) => void; onError: (msg: string) => void }) {
  const [phase, setPhase] = useState<'verifying' | 'done'>('verifying')

  useEffect(() => {
    api.verifySetupProfile(profileId).then(
      (resp) => { setPhase('done'); onResult(resp.result) },
      (err) => { setPhase('done'); onError(err instanceof Error ? err.message : '验证失败') },
    )
  }, [profileId, onResult, onError])

  if (phase === 'verifying') {
    return (
      <div className="wizard-testing">
        <div className="wizard-spinner" />
        <h3>正在验证连接…</h3>
        <p className="text-muted">通过 OpenSSH 别名 {profileId} 执行固定的只读能力探针。不生成密钥、不修改 known_hosts。</p>
      </div>
    )
  }
  return null
}

/* ── Live verification error ── */
function LiveVerifyError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="wizard-result wizard-result-fail">
      <div className="wizard-result-icon">{'\u2718'}</div>
      <h3>验证连接失败</h3>
      <p className="text-secondary">无法通过指定的 SSH 别名完成只读验证。</p>
      <p className="text-muted" style={{ fontSize: '0.7rem', maxWidth: 480, wordBreak: 'break-word' }}>{error}</p>
      <div className="wizard-actions">
        <button className="btn btn-secondary" onClick={onRetry}>重试</button>
      </div>
    </div>
  )
}

/* ── Live capability display ── */
function LiveCapabilityStep({ result, onNext }: { result: CapabilityResult; onNext: () => void }) {
  const caps = result.capabilities
  const items = [
    { label: '运行状态读取', ok: caps.monitoring === 'available', detail: caps.monitoring === 'available' ? '可读取已登记服务状态' : caps.monitoring === 'unknown' ? '尚未确认' : '当前不可读取' },
    { label: '本机服务控制', ok: false, detail: '默认关闭；完成连接后可在“设置”启用本机模型服务控制' },
  ]
  return (
    <div className="wizard-capabilities">
      <h3>能力检查结果</h3>
      <p className="text-secondary">连接状态：<strong>{result.connection === 'reachable' ? '可达' : result.connection}</strong> · 检查时间：{new Date(result.checkedAt).toLocaleString('zh-CN')}</p>
      <ul className="wizard-cap-list">
        {items.map((item) => (
          <li key={item.label} className={item.ok ? 'wizard-cap-ok' : 'wizard-cap-warn'}>
            <span className="wizard-cap-icon">{item.ok ? '\u2714' : '\u26A0'}</span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
            <span className={`wizard-cap-badge ${item.ok ? 'badge-ok' : 'badge-warn'}`}>{item.ok ? '通过' : '受限'}</span>
          </li>
        ))}
      </ul>
      <div className="wizard-actions">
        <span className="wizard-hint mock-hint">{isLive ? '真实连接验证；不会在此步骤执行模型操作' : '模拟模式'}</span>
        <button className="btn btn-primary" onClick={onNext}>继续</button>
      </div>
    </div>
  )
}

/* ── Mock: Connection form ── */
function MockConnectionForm({
  config, onChange, onNext,
}: { config: ConnectionConfig; onChange: (c: ConnectionConfig) => void; onNext: () => void }) {
  const valid = config.name.trim() && config.address.trim() && config.port > 0
  return (
    <form className="wizard-form" onSubmit={(e) => { e.preventDefault(); if (valid) onNext() }}>
      <div className="wizard-form-group">
        <label htmlFor="wiz-name">DGX 名称</label>
        <input id="wiz-name" type="text" placeholder="例：我的 DGX Spark" value={config.name} onChange={(e) => onChange({ ...config, name: e.target.value })} />
        <small>为本机显示的别名。</small>
      </div>
      <div className="wizard-form-group">
        <label htmlFor="wiz-address">地址</label>
        <input id="wiz-address" type="text" placeholder="例：192.168.1.100 或 dgx.local" value={config.address} onChange={(e) => onChange({ ...config, address: e.target.value })} />
        <small>DGX 的 IP 地址或主机名。</small>
      </div>
      <div className="wizard-form-group">
        <label htmlFor="wiz-port">SSH 端口</label>
        <input id="wiz-port" type="number" min={1} max={65535} value={config.port} onChange={(e) => onChange({ ...config, port: Number(e.target.value) || 22 })} />
        <small>默认为 22。</small>
      </div>
      <fieldset className="wizard-form-group">
        <legend>SSH 身份方式</legend>
        <label className="wizard-radio"><input type="radio" name="identity" value="existing-key" checked={config.identityMethod === 'existing-key'} onChange={() => onChange({ ...config, identityMethod: 'existing-key' })} /><div><strong>使用现有 SSH 密钥</strong><small>使用当前用户 ~/.ssh/id_rsa。</small></div></label>
        <label className="wizard-radio"><input type="radio" name="identity" value="new-key" checked={config.identityMethod === 'new-key'} onChange={() => onChange({ ...config, identityMethod: 'new-key' })} /><div><strong>生成新密钥对</strong><small>本地创建新的 SSH 密钥。</small></div></label>
      </fieldset>
      <div className="wizard-actions"><span className="wizard-hint mock-hint">模拟模式</span><button type="submit" className="btn btn-primary" disabled={!valid}>测试连接</button></div>
    </form>
  )
}

/* ── Mock: Testing ── */
function MockTestingStep({ onResult }: { onResult: (r: any) => void }) {
  const [phase] = useState<'connecting'>('connecting')
  if (phase === 'connecting') {
    return (
      <div className="wizard-testing">
        <div className="wizard-spinner" />
        <h3>正在测试连接…</h3>
        <p className="text-muted">模拟 SSH 连接。</p>
        <div className="wizard-testing-actions">
          <button className="btn btn-primary" onClick={() => onResult(mockTestSuccess)}>模拟连接成功</button>
          <button className="btn btn-secondary" onClick={() => onResult(mockTestFailure)}>模拟连接失败</button>
        </div>
      </div>
    )
  }
  return null
}

/* ── Mock: Test result ── */
function MockTestResult({ result, onRetry, onNext, onBack }: { result: any; onRetry: () => void; onNext: () => void; onBack: () => void }) {
  return (
    <div className={`wizard-result ${result.success ? 'wizard-result-ok' : 'wizard-result-fail'}`}>
      <div className="wizard-result-icon">{result.success ? '\u2714' : '\u2718'}</div>
      <h3>{result.success ? '连接测试成功' : '连接测试失败'}</h3>
      <p className="text-secondary">{result.message}</p>
      {result.success && (
        <div className="wizard-result-details">
          <div className="wizard-detail-row"><span>延迟</span><strong>{result.latencyMs} ms</strong></div>
          <div className="wizard-detail-row"><span>认证方式</span><strong>{result.authMethod}</strong></div>
          <div className="wizard-detail-row"><span>服务器指纹</span><strong className="mono">{result.serverFingerprint}</strong></div>
        </div>
      )}
      <div className="wizard-actions">
        {!result.success && <button className="btn btn-secondary" onClick={onRetry}>重试</button>}
        <button className="btn btn-secondary" onClick={onBack}>返回修改</button>
        {result.success && <button className="btn btn-primary" onClick={onNext}>确认并继续</button>}
      </div>
    </div>
  )
}

/* ── Mock: Capability check ── */
function MockCapabilityStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="wizard-capabilities">
      <h3>服务能力检查（模拟）</h3>
      <p className="text-secondary">已检测到 {mockCapabilities.length} 项服务能力。</p>
      <ul className="wizard-cap-list">
        {mockCapabilities.map((r) => (
          <li key={r.service} className={r.compatible ? 'wizard-cap-ok' : 'wizard-cap-warn'}>
            <span className="wizard-cap-icon">{r.compatible ? '\u2714' : '\u26A0'}</span>
            <div><strong>{r.service}</strong><small>当前 {r.version} · 要求 {r.requiredVersion}</small><small className={r.compatible ? '' : 'text-warning'}>{r.note}</small></div>
            <span className={`wizard-cap-badge ${r.compatible ? 'badge-ok' : 'badge-warn'}`}>{r.compatible ? '兼容' : '需升级'}</span>
          </li>
        ))}
      </ul>
      <div className="wizard-actions"><span className="wizard-hint mock-hint">模拟模式</span><button className="btn btn-primary" onClick={onNext}>继续</button></div>
    </div>
  )
}

/* ── Complete step ── */
function CompleteStep(): ReactElement {
  return (
    <div className="wizard-complete">
      <div className="wizard-complete-icon">{'\u2714'}</div>
      <h3>设置完成</h3>
      <p className="text-secondary">DGX 连接配置已保存。控制台现在可以监控 DGX 状态。</p>
      <div className="wizard-complete-cards">
        <div className="wizard-complete-card"><span className="wizard-complete-card-icon">{'\u{1F4CA}'}</span><strong>监控面板</strong><small>查看模型状态和系统指标。</small></div>
        <div className="wizard-complete-card"><span className="wizard-complete-card-icon">{'\u{1F527}'}</span><strong>模型参数</strong><small>查看与预览参数变更。</small></div>
        <div className="wizard-complete-card"><span className="wizard-complete-card-icon">{'\u{1F4CB}'}</span><strong>审计记录</strong><small>所有操作均可追溯。</small></div>
      </div>
      <p className="wizard-complete-note mock-hint">{isLive ? '本机真实配置已保存。' : '模拟模式 — 向导内容为前端静态演示。'}</p>
    </div>
  )
}

/* ── Step indicator bar ── */
function StepIndicator({ step }: { step: WizardStep }) {
  const current = stepIndex(step)
  return (
    <nav className="wizard-stepper" aria-label="设置步骤">
      {STEPS.map((s, i) => {
        let cls = 'wizard-step'
        if (i < current) cls += ' done'
        else if (i === current) cls += ' active'
        return <div key={s.id} className={cls}><span className="wizard-step-num">{i < current ? '\u2714' : s.num}</span><span className="wizard-step-label">{s.label}</span></div>
      })}
    </nav>
  )
}

/* ── Main Setup Page ── */
export default function Setup() {
  const { runtime, loading: runtimeLoading } = useDesktopRuntime()
  // Mock state (used only when api.mode !== 'live')
  const [mockStep, setMockStep] = useState<WizardStep>('connection')
  const [mockConn, setMockConn] = useState<ConnectionConfig>({ ...mockDefaultConnection })
  const [mockTestResult, setMockTestResult] = useState<any>(null)

  // Live state
  const [liveState, setLiveState] = useState<ReturnType<typeof initialState>>(initialState())

  // ── Live mode flow ──
  if (isLive) {
    const step: WizardStep = liveState.step
    return (
      <div className="setup-page">
        <header className="setup-header">
          <p className="eyebrow">初始设置</p>
          <h2>连接 DGX</h2>
          <p className="subtitle">使用 Windows OpenSSH 别名完成连接配置。不接触私钥或密码。</p>
        </header>
        {typeof window !== 'undefined' && shouldShowProtectedLanNotice({ desktopChannel: runtime?.channel === 'desktop', loading: runtimeLoading, hostname: window.location.hostname }) && <ProtectedLanNotice />}
        <StepIndicator step={step} />
        <div className="wizard-body">
          {step === 'connection' && liveState.failure === 'verify' && liveState.error && (
            <LiveVerifyError error={localizedRuntimeMessage(liveState.error, '连接验证失败，请检查当前 OpenSSH 连接。')} onRetry={() => setLiveState((state) => transition(state, 'profilesLoadRetry'))} />
          )}
          {step === 'connection' && liveState.failure !== 'verify' && (
            <LiveConnectionForm
              key={liveState.profileLoad}
              onNext={(profileId) => setLiveState((state) => transition(state, 'saveProfileOk', { profileId }))}
              onSaveError={(error) => setLiveState((state) => transition(state, 'saveProfileFail', { error }))}
              onProfilesLoadError={(error) => setLiveState((state) => transition(state, 'profilesLoadFail', { error }))}
              onProfilesRetry={() => setLiveState((state) => transition(state, 'profilesLoadRetry'))}
              unavailableError={liveState.profileLoad === 'unavailable' ? liveState.error : null}
              saveError={liveState.failure === 'save' ? liveState.error : null}
            />
          )}
          {step === 'testing' && liveState.profileId && (
            <LiveVerifyStep
              profileId={liveState.profileId}
              onResult={(result) => setLiveState((state) => transition(state, 'verifyOk', { result }))}
              onError={(error) => setLiveState((state) => transition(state, 'verifyFail', { error }))}
            />
          )}
          {step === 'capabilities' && liveState.capabilityResult !== null && (
            <LiveCapabilityStep result={liveState.capabilityResult as CapabilityResult} onNext={() => setLiveState((state) => transition(state, 'capabilitiesOk'))} />
          )}
          {step === 'complete' && <CompleteStep />}
        </div>
      </div>
    )
  }

  // ── Mock mode flow ──
  const step = mockStep
  return (
    <div className="setup-page">
      <header className="setup-header">
        <p className="eyebrow">初始设置</p>
        <h2>连接 DGX</h2>
        <p className="subtitle">首次运行需完成连接配置。所有凭据保存在本地，不上传。</p>
      </header>
      <StepIndicator step={step} />
      <div className="wizard-body">
        {step === 'connection' && (
          <MockConnectionForm config={mockConn} onChange={setMockConn} onNext={() => setMockStep('testing')} />
        )}
        {step === 'testing' && mockTestResult === null && (
          <MockTestingStep onResult={(r) => { setMockTestResult(r); setMockStep(r.success ? 'fingerprint' : 'testing') }} />
        )}
        {step === 'testing' && mockTestResult !== null && !mockTestResult.success && (
          <MockTestResult result={mockTestResult} onRetry={() => { setMockTestResult(null) }} onNext={() => {}} onBack={() => setMockStep('connection')} />
        )}
        {step === 'fingerprint' && mockTestResult?.success && (
          <div className="wizard-fingerprint">
            <div className="wizard-fingerprint-icon">{'\u{1F512}'}</div>
            <h3>确认服务器指纹</h3>
            <p className="text-secondary">首次连接需确认 SSH 指纹。</p>
            <div className="wizard-fingerprint-box"><span className="wizard-fingerprint-label">SSH 服务器指纹</span><code className="wizard-fingerprint-value">{mockTestResult.serverFingerprint}</code></div>
            <div className="wizard-actions">
              <button className="btn btn-secondary" onClick={() => setMockStep('connection')}>拒绝</button>
              <button className="btn btn-primary" onClick={() => setMockStep('capabilities')}>确认指纹，继续</button>
            </div>
          </div>
        )}
        {step === 'capabilities' && <MockCapabilityStep onNext={() => setMockStep('complete')} />}
        {step === 'complete' && <CompleteStep />}
      </div>
    </div>
  )
}

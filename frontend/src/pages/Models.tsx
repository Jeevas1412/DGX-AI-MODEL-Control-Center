import { useCallback, useEffect, useState } from 'react'
import { api, type CatalogModelEntry, type CatalogSearchResult, type ManagedServicePlan, type ModelServiceAdapter, type ModelServiceDraft, type ModelServicePrecheck, type ModelServiceRegistrationPlan, type ModelServiceTemplate, type Nvfp4ParameterAdapterDeploymentPlan, type Nvfp4ParameterAdapterStatus, type Nvfp4ParameterPlan, type Nvfp4ParameterOperation, type Nvfp4ParameterReview } from '../services/api'
import { localizedRuntimeMessage } from '../services/localized-runtime'
import { controlDisclosure, planExpiryLabel } from '../services/control-disclosure'
import type { Nvfp4StartupConfig } from '../types'
import './Models.css'

type Tab = 'catalog' | 'configuration' | 'managed' | 'parameters'

type Nvfp4EditableKey = 'maxModelLen' | 'gpuMemoryUtilization' | 'maxNumSeqs' | 'maxNumBatchedTokens'

const nvfp4ParameterGuidance: Array<{ key: Nvfp4EditableKey; label: string; min: number; max: number; step: number; note: string }> = [
  { key: 'maxModelLen', label: '最大上下文', min: 4096, max: 65536, step: 1024, note: '上下文越大，KV Cache 占用越高；从当前值向下调整可释放内存。' },
  { key: 'gpuMemoryUtilization', label: 'GPU 内存利用率', min: 0.5, max: 0.9, step: 0.01, note: '当前已验证配置可低至 0.50；建议按实际负载逐步调整，且不超过 0.90。' },
  { key: 'maxNumSeqs', label: '最大并发序列', min: 1, max: 128, step: 1, note: '并发越高，瞬时内存与调度压力越大。' },
  { key: 'maxNumBatchedTokens', label: '最大批处理 Token', min: 4096, max: 65536, step: 1024, note: '批处理越大，吞吐上限越高，但会增加峰值内存。' },
]

function initialNvfp4Draft(values: Nvfp4StartupConfig): Record<Nvfp4EditableKey, string> {
  return Object.fromEntries(nvfp4ParameterGuidance.map(({ key }) => [key, values[key] === null ? '' : String(values[key])])) as Record<Nvfp4EditableKey, string>
}

function suggestedServiceTemplate(modelId: string, templates: ModelServiceTemplate[]): string {
  const identifier = modelId.toLowerCase()
  const preferred = /(?:qwen.*vl|vision|llava|internvl|molmo)/.test(identifier)
    ? 'openai-compatible-vision'
    : /(?:comfy|flux|stable-diffusion|sdxl|wan|image)/.test(identifier)
      ? 'image-workflow'
      : 'openai-compatible-text'
  return templates.some((template) => template.id === preferred) ? preferred : templates[0]?.id ?? ''
}

export default function Models() {
  const [tab, setTab] = useState<Tab>('catalog')
  const [catalog, setCatalog] = useState<CatalogModelEntry[]>([])
  const [candidates, setCandidates] = useState<CatalogSearchResult[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ModelServiceTemplate[]>([])
  const [adapters, setAdapters] = useState<ModelServiceAdapter[]>([])
  const [drafts, setDrafts] = useState<ModelServiceDraft[]>([])
  const [configModelId, setConfigModelId] = useState('')
  const [configTemplateId, setConfigTemplateId] = useState('')
  const [savingDraft, setSavingDraft] = useState(false)
  const [onboardingModelId, setOnboardingModelId] = useState<string | null>(null)
  const [prechecks, setPrechecks] = useState<Record<string, ModelServicePrecheck>>({})
  const [checkingDraftId, setCheckingDraftId] = useState<string | null>(null)
  const [registrationPlans, setRegistrationPlans] = useState<Record<string, ModelServiceRegistrationPlan>>({})
  const [creatingPlanId, setCreatingPlanId] = useState<string | null>(null)
  const [confirmingPlanId, setConfirmingPlanId] = useState<string | null>(null)
  const [parameterTarget, setParameterTarget] = useState('')
  const [nvfp4Parameters, setNvfp4Parameters] = useState<Nvfp4StartupConfig | null>(null)
  const [parametersLoading, setParametersLoading] = useState(false)
  const [nvfp4Draft, setNvfp4Draft] = useState<Record<Nvfp4EditableKey, string> | null>(null)
  const [parameterReview, setParameterReview] = useState<Nvfp4ParameterReview | null>(null)
  const [reviewingParameters, setReviewingParameters] = useState(false)
  const [parameterAdapter, setParameterAdapter] = useState<Nvfp4ParameterAdapterStatus | null>(null)
  const [parameterAdapterPlan, setParameterAdapterPlan] = useState<Nvfp4ParameterAdapterDeploymentPlan | null>(null)
  const [deployingParameterAdapter, setDeployingParameterAdapter] = useState(false)
  const [parameterPlan, setParameterPlan] = useState<Nvfp4ParameterPlan | null>(null)
  const [parameterOperation, setParameterOperation] = useState<Nvfp4ParameterOperation | null>(null)
  const [parameterBusy, setParameterBusy] = useState(false)
  const [managedPlans, setManagedPlans] = useState<Record<string, ManagedServicePlan>>({})
  const [confirmingManagedPlanId, setConfirmingManagedPlanId] = useState<string | null>(null)

  const refreshCatalog = useCallback(async () => {
    setLoadingCatalog(true)
    setCatalogError(null)
    try {
      const [entries, found, serviceTemplates, serviceDrafts, serviceAdapters] = await Promise.all([api.getModelCatalog(), api.searchModelCatalog(''), api.getModelServiceTemplates(), api.getModelServiceDrafts(), api.getModelServiceAdapters()])
      setCatalog(entries)
      setCandidates(found.filter((item) => !entries.some((entry) => entry.modelId === item.modelId)))
      setTemplates(serviceTemplates)
      setDrafts(serviceDrafts)
      setAdapters(serviceAdapters)
    } catch (error) {
      setCatalogError(localizedRuntimeMessage(error instanceof Error ? error.message : null, '无法读取已验证的 DGX 本地模型目录。'))
    } finally {
      setLoadingCatalog(false)
    }
  }, [])

  useEffect(() => { void refreshCatalog() }, [refreshCatalog])

  function openServiceOnboarding(model: CatalogModelEntry) {
    const existing = drafts.find((draft) => draft.catalogEntryId === model.id)
    if (existing?.status === 'registered') {
      setTab('managed')
      setNotice(`“${model.displayName}”已是受控服务；可在“已管理服务”或运行总览中创建操作计划。`)
      return
    }
    setConfigModelId(model.id)
    setConfigTemplateId(existing?.templateId ?? suggestedServiceTemplate(model.modelId, templates))
    setTab('configuration')
    setNotice(`已打开“${model.displayName}”的受控接入流程。请确认服务类型后创建本机草稿和预检；此步骤不会启动模型。`)
  }

  async function addModel(candidate: CatalogSearchResult) {
    setAddingId(candidate.resultId)
    setNotice(null)
    try {
      const entry = await api.addModelToCatalog(candidate)
      setCatalog((items) => [...items, entry])
      setCandidates((items) => items.filter((item) => item.resultId !== candidate.resultId))
      openServiceOnboarding(entry)
    } catch (error) {
      setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '添加模型失败；未对 DGX 执行任何模型操作。'))
    } finally {
      setAddingId(null)
    }
  }

  async function beginServiceOnboarding() {
    const model = catalog.find((entry) => entry.id === configModelId)
    if (!model || !configTemplateId) return
    setSavingDraft(true); setOnboardingModelId(model.id); setNotice(null)
    try {
      const draft = await api.createModelServiceDraft({ catalogEntryId: model.id, templateId: configTemplateId, displayName: model.displayName })
      setDrafts((items) => [...items.filter((item) => item.id !== draft.id), draft])
      if (draft.status === 'registered') {
        setTab('managed')
        setNotice(`“${draft.displayName}”已完成受控登记；不会重新登记或自动启动模型。`)
        return
      }
      const precheck = await api.precheckModelServiceDraft(draft.id)
      setPrechecks((items) => ({ ...items, [draft.id]: precheck }))
      if (!precheck.registrationEligible) {
        setNotice(`“${draft.displayName}”已建立本机草稿，但尚未满足受控接入条件：${precheck.nextStep}`)
        return
      }
      const plan = await api.createModelServiceRegistrationPlan(draft.id)
      setRegistrationPlans((items) => ({ ...items, [draft.id]: plan }))
        setNotice(`“${draft.displayName}”已完成草稿与适配器预检，登记计划已就绪。请在下方确认登记；确认本身不会启动模型。${precheck.eligible ? '' : ' 当前启动条件未满足，登记后仍会如实阻止启动。'}`)
    } catch (error) { setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '无法完成受控接入准备。未对 DGX 执行任何模型操作。')) } finally { setSavingDraft(false); setOnboardingModelId(null) }
  }
  async function precheckDraft(id: string) {
    setCheckingDraftId(id)
    try { const result = await api.precheckModelServiceDraft(id); setPrechecks((items) => ({ ...items, [id]: result })) }
    catch (error) { setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '无法完成服务适配器预检。')) }
    finally { setCheckingDraftId(null) }
  }
  async function createRegistrationPlan(id: string) {
    setCreatingPlanId(id); setNotice(null)
    try {
      const plan = await api.createModelServiceRegistrationPlan(id)
      setRegistrationPlans((items) => ({ ...items, [id]: plan }))
      setNotice('登记计划已创建，等待你的确认。此时只保存计划，不会登记服务或启动模型。')
    } catch (error) { setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '无法创建受控服务登记计划。')) }
    finally { setCreatingPlanId(null) }
  }
  async function confirmRegistration(draft: ModelServiceDraft) {
    const plan = registrationPlans[draft.id]
    if (!plan) return
    setConfirmingPlanId(plan.id); setNotice(null)
    try {
      const registered = await api.confirmModelServiceRegistrationPlan(plan.id)
      setDrafts((items) => items.map((item) => item.id === registered.id ? registered : item))
      setRegistrationPlans((items) => { const next = { ...items }; delete next[draft.id]; return next })
      setTab('managed')
      setNotice(`“${registered.displayName}”已完成受控登记。此步骤只写入服务登记，不会启动、停止或重启模型。`)
    } catch (error) { setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '受控服务登记未完成；未执行模型操作。')) }
    finally { setConfirmingPlanId(null) }
  }
  async function selectParameterTarget(target: string) {
    setParameterTarget(target); setNvfp4Parameters(null); setNvfp4Draft(null); setParameterReview(null); setParameterAdapter(null); setParameterAdapterPlan(null)
    if (target !== 'builtin-nvfp4') return
    setParametersLoading(true)
    try {
      const [config, adapter] = await Promise.all([api.getNvfp4StartupConfigState(), api.getNvfp4ParameterAdapterStatus()])
      const values = config.data
      setNvfp4Parameters(values)
      setNvfp4Draft(initialNvfp4Draft(values))
      setParameterAdapter(adapter)
    }
    catch (error) { setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '无法读取 NVFP4 参数。')) }
    finally { setParametersLoading(false) }
  }
  function managedParameterContract(target: string): ModelServiceAdapter | null {
    const id = target.replace(/^managed-/, '')
    const draft = drafts.find((item) => item.id === id)
    if (!draft?.adapterId || !draft.adapterVersion) return null
    return adapters.find((adapter) => adapter.id === draft.adapterId && adapter.version === draft.adapterVersion) ?? null
  }
  function actionsForManaged(entry: ModelServiceDraft): Array<'warmup' | 'restart' | 'stop'> {
    if (!entry.adapterId || !entry.adapterVersion) return []
    return adapters.find((adapter) => adapter.id === entry.adapterId && adapter.version === entry.adapterVersion)?.actions ?? []
  }
  async function planManagedAction(id: string, action: 'warmup' | 'restart' | 'stop') {
    setNotice(null)
    try {
      const plan = await api.createManagedServicePlan(id, action)
      setManagedPlans((items) => ({ ...items, [id]: plan }))
      setNotice(`“${controlDisclosure(action).actionLabel}”计划已创建，等待你的确认；尚未向 DGX 发送服务控制请求。`)
    } catch (error) {
      setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '无法创建服务操作计划。'))
    }
  }
  async function confirmManagedAction(id: string) {
    const plan = managedPlans[id]
    if (!plan) return
    setConfirmingManagedPlanId(plan.id)
    try {
      const outcome = await api.confirmManagedServicePlan(plan.id)
      setNotice(localizedRuntimeMessage(outcome.message, '操作已提交；请在运行总览中查看状态复核结果。'))
      setManagedPlans((items) => { const next = { ...items }; delete next[id]; return next })
    } catch (error) {
      setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '服务操作未完成。'))
    } finally {
      setConfirmingManagedPlanId(null)
    }
  }
  async function reviewParameterDraft() {
    if (!nvfp4Draft) return
    const invalid = nvfp4ParameterGuidance.find((field) => {
      const value = Number(nvfp4Draft[field.key])
      return !Number.isFinite(value) || value < field.min || value > field.max
    })
    if (invalid) { setNotice(`“${invalid.label}”必须处于建议范围 ${invalid.min}–${invalid.max}。未创建任何 DGX 修改计划。`); return }
    setReviewingParameters(true); setNotice(null)
    try {
      const proposed = Object.fromEntries(nvfp4ParameterGuidance.map((field) => [field.key, Number(nvfp4Draft[field.key])]))
      const review = await api.createNvfp4ParameterReview(proposed)
      setParameterReview(review)
      setNotice('已创建本地参数审查和审计记录。此操作未写入 DGX、未重启服务，也不会启动模型。')
    } catch (error) {
      setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '无法创建参数调整审查；未向 DGX 写入任何内容。'))
    } finally { setReviewingParameters(false) }
  }
  async function createParameterAdapterDeploymentPlan() {
    setDeployingParameterAdapter(true); setNotice(null)
    try { setParameterAdapterPlan(await api.createNvfp4ParameterAdapterDeploymentPlan()); setNotice('固定参数适配器部署计划已创建，等待你的确认；此时未写入 DGX。') }
    catch (error) { setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '无法创建固定参数适配器部署计划。')) }
    finally { setDeployingParameterAdapter(false) }
  }
  async function confirmParameterAdapterDeployment() {
    if (!parameterAdapterPlan) return
    setDeployingParameterAdapter(true); setNotice(null)
    try { const outcome = await api.confirmNvfp4ParameterAdapterDeploymentPlan(parameterAdapterPlan.id); setParameterAdapter(outcome.status); setParameterAdapterPlan(null); setNotice(outcome.message) }
    catch (error) { setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '固定参数适配器部署未完成。')) }
    finally { setDeployingParameterAdapter(false) }
  }
  async function createParameterApplyPlan() {
    if (!nvfp4Draft) return
    setParameterBusy(true); setNotice(null)
    try { setParameterPlan(await api.createNvfp4ParameterPlan(Object.fromEntries(nvfp4ParameterGuidance.map((field) => [field.key, Number(nvfp4Draft[field.key])]))) ); setNotice('参数写入计划已创建，等待你的确认；此时尚未修改 DGX 参数，也不会重启模型。') }
    catch (error) { setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '无法创建参数写入计划。')) }
    finally { setParameterBusy(false) }
  }
  async function confirmParameterApplyPlan() {
    if (!parameterPlan) return
    setParameterBusy(true); setNotice(null)
    try { const operation = await api.confirmNvfp4ParameterPlan(parameterPlan.id); setParameterOperation(operation); setParameterPlan(null); setNotice(operation.message) }
    catch (error) { setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '参数写入没有完成；模型未被自动重启。')) }
    finally { setParameterBusy(false) }
  }
  async function createRollbackPlan() {
    if (!parameterOperation) return
    setParameterBusy(true); setNotice(null)
    try { setParameterPlan(await api.createNvfp4RollbackPlan(parameterOperation.id)); setNotice('参数恢复计划已创建，等待你的确认；此时尚未修改 DGX 参数。') }
    catch (error) { setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '无法创建回滚计划。')) }
    finally { setParameterBusy(false) }
  }
  async function confirmRollbackPlan() {
    if (!parameterPlan) return
    setParameterBusy(true); setNotice(null)
    try { const operation = await api.confirmNvfp4RollbackPlan(parameterPlan.id); setParameterOperation(operation); setParameterPlan(null); setNotice(operation.message) }
    catch (error) { setNotice(localizedRuntimeMessage(error instanceof Error ? error.message : null, '参数回滚没有完成；模型未被自动重启。')) }
    finally { setParameterBusy(false) }
  }

  return <div className="page-container models-page">
    <header className="page-header">
      <p className="eyebrow">模型管理</p>
      <h2>模型库与模型参数</h2>
      <p className="subtitle">模型库用于发现并添加 DGX 上已存在的模型；模型参数只在选择具体模型后显示。服务启动、停止与重启仍在“运行总览”中通过计划和二次确认执行。</p>
    </header>

    <div className="model-page-tabs" role="tablist" aria-label="模型管理功能">
      <button className={tab === 'catalog' ? 'active' : ''} role="tab" aria-selected={tab === 'catalog'} onClick={() => setTab('catalog')}>模型库</button>
      <button className={tab === 'configuration' ? 'active' : ''} role="tab" aria-selected={tab === 'configuration'} onClick={() => setTab('configuration')}>新模型服务配置</button>
      <button className={tab === 'managed' ? 'active' : ''} role="tab" aria-selected={tab === 'managed'} onClick={() => setTab('managed')}>已管理服务</button>
      <button className={tab === 'parameters' ? 'active' : ''} role="tab" aria-selected={tab === 'parameters'} onClick={() => setTab('parameters')}>模型参数</button>
    </div>
    {notice && <div className="overview-notice"><span>{notice}</span><button onClick={() => setNotice(null)}>关闭</button></div>}

    {tab === 'catalog' && <section className="settings-card full-width">
      <div className="card-title-row"><div><p className="eyebrow">本地发现</p><h3 className="card-title">模型库</h3><p className="subtitle">刷新后仅显示当前已验证连接上发现的本地模型。流程：刷新本地发现结果 → 选择模型 → 添加到客户端管理。</p></div><button className="btn btn-secondary" onClick={() => void refreshCatalog()} disabled={loadingCatalog}>{loadingCatalog ? '正在刷新…' : '刷新本地模型'}</button></div>
      {catalogError && <div className="overview-alert">{catalogError}</div>}
      <div className="model-catalog-registered"><p className="eyebrow">客户端已管理</p><h4>已添加模型</h4>{catalog.length ? <div className="model-catalog-results">{catalog.map((entry) => { const draft = drafts.find((item) => item.catalogEntryId === entry.id); return <article key={entry.id} className="model-catalog-entry"><div><strong>{entry.displayName}</strong><small>模型标识：{entry.modelId}</small><p>{draft?.status === 'registered' ? '已完成受控登记，可在总览中创建启动、重启或停止计划。' : draft ? '已建立受控接入草稿；继续接入后会重新进行适配器与资源预检。' : '已添加到客户端管理；开始受控接入后会自动建立草稿并检查固定适配器条件。'}</p></div><button className="btn btn-secondary" onClick={() => openServiceOnboarding(entry)}>{draft?.status === 'registered' ? '查看已管理服务' : onboardingModelId === entry.id ? '正在接入…' : '开始受控接入'}</button></article> })}</div> : <div className="model-catalog-empty"><strong>尚未添加模型</strong><span>从下方已发现的 DGX 本地模型中选择“添加并接入”。</span></div>}</div>
      <div className="model-catalog-registered"><p className="eyebrow">已发现但未管理</p><h4>可添加的本地模型</h4>{loadingCatalog ? <p>正在读取当前连接上的本地模型目录…</p> : candidates.length ? <div className="model-catalog-results">{candidates.map((candidate) => <article key={candidate.resultId} className="model-catalog-entry"><div><strong>{candidate.displayName}</strong><small>来源：已验证 DGX 本地模型目录</small><p>添加后会直接打开受控接入流程；不会下载权重或启动模型。</p></div><button className="btn btn-primary" disabled={addingId === candidate.resultId} onClick={() => void addModel(candidate)}>{addingId === candidate.resultId ? '正在添加…' : '添加并接入'}</button></article>)}</div> : <div className="model-catalog-empty"><strong>没有可添加的模型</strong><span>当前发现结果均已由客户端管理，或连接尚未提供可读取的本地模型目录。</span></div>}</div>
    </section>}

    {tab === 'configuration' && <section className="settings-card full-width">
      <p className="eyebrow">受控接入向导</p><h3 className="card-title">新模型服务配置</h3><p className="subtitle">选择已添加模型与服务类型后，程序会建立本机草稿，并读取当前已验证目标上已有的固定适配器、资源与队列；满足条件后才可创建登记计划。整个准备过程不会启动模型。</p>
      <label className="form-label" htmlFor="service-config-model">已添加模型</label><select id="service-config-model" className="form-select" value={configModelId} onChange={(event) => setConfigModelId(event.target.value)}><option value="">请选择模型</option>{catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}</select>
      <label className="form-label" htmlFor="service-config-template">服务模板</label><select id="service-config-template" className="form-select" value={configTemplateId} onChange={(event) => setConfigTemplateId(event.target.value)}><option value="">请选择受支持模板</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.displayName}（需要验证适配器）</option>)}</select>
      <button className="btn btn-primary" disabled={!configModelId || !configTemplateId || savingDraft} onClick={() => void beginServiceOnboarding()}>{savingDraft ? '正在准备…' : '开始受控接入'}</button>
      <div className="model-parameter-panel"><h4>服务适配器</h4><p>通用版本不内置任何特定模型、目录、端口或远端脚本。程序只会读取并验证当前已验证目标上已存在的固定适配器。</p><p className="parameter-boundary">如果预检提示缺少适配器，表示该模型尚无经过产品审阅的支持包；不会生成命令、猜测路径或伪造可加载状态。支持包准备完成后，刷新页面并重新检查即可继续登记。</p></div>
      <div className="model-parameter-panel"><h4>当前连接的配置草稿</h4>{drafts.filter((draft) => draft.status === 'draft').length ? <div className="model-catalog-results">{drafts.filter((draft) => draft.status === 'draft').map((draft) => <article key={draft.id} className="model-catalog-entry"><div><strong>{draft.displayName}</strong><small>模板：{templates.find((template) => template.id === draft.templateId)?.displayName ?? draft.templateId}</small><p>状态：配置草稿。尚未登记到 DGX，尚不可加载。</p>{prechecks[draft.id] && <p>{prechecks[draft.id].checks.map((check) => `${check.status === 'passed' ? '✓' : '!' } ${check.message}`).join('　')}<br />{prechecks[draft.id].nextStep}</p>}{registrationPlans[draft.id] && <div className="operation-disclosure"><strong>登记计划已创建，等待你的确认</strong><p>{registrationPlans[draft.id].summary}</p><p>确认后只会登记受控服务；不会启动、停止或重启模型。</p><p>计划有效至：{planExpiryLabel(registrationPlans[draft.id].expiresAt)}。</p></div>}</div><div className="model-draft-actions"><button className="btn btn-secondary" disabled={checkingDraftId === draft.id} onClick={() => void precheckDraft(draft.id)}>{checkingDraftId === draft.id ? '正在预检…' : '检查适配器条件'}</button>{prechecks[draft.id]?.registrationEligible && !registrationPlans[draft.id] && <button className="btn btn-primary" disabled={creatingPlanId === draft.id} onClick={() => void createRegistrationPlan(draft.id)}>{creatingPlanId === draft.id ? '正在创建计划…' : '创建登记计划'}</button>}{registrationPlans[draft.id] && <button className="btn btn-primary" disabled={confirmingPlanId === registrationPlans[draft.id].id} onClick={() => void confirmRegistration(draft)}>{confirmingPlanId === registrationPlans[draft.id].id ? '正在登记…' : '确认并登记'}</button>}</div></article>)}</div> : <p>尚未创建待登记服务配置草稿。</p>}</div>
    </section>}

    {tab === 'managed' && <section className="settings-card full-width">
      <p className="eyebrow">已完成登记</p><h3 className="card-title">已管理服务</h3><p className="subtitle">这里仅显示通过固定适配器预检、受控登记和真实状态复核的服务。模型库中的“已添加模型”和服务配置中的“草稿”不会出现在这里。</p>
      {drafts.filter((draft) => draft.status === 'registered').length ? <div className="model-catalog-results">{drafts.filter((draft) => draft.status === 'registered').map((entry) => { const actions = actionsForManaged(entry); const plan = managedPlans[entry.id]; const disclosure = plan ? controlDisclosure(plan.action) : null; return <article key={entry.id} className="model-catalog-entry"><div><strong>{entry.displayName}</strong><small>适配器：{entry.adapterId} {entry.adapterVersion}</small><p>已完成受控登记。所有操作都会先创建计划，随后由用户再次确认；不会自动执行。</p>{actions.length ? <p>该适配器已验证的动作：{actions.map((action) => action === 'warmup' ? '启动 / 预热' : action === 'restart' ? '重启' : '停止').join('、')}。</p> : <p>当前未读到可验证的适配器动作，所有控制已安全禁用。</p>}{plan && disclosure && <div className="operation-disclosure"><strong>操作计划待确认，尚未执行</strong><p>目标：{entry.displayName}；动作：{disclosure.actionLabel}；风险：{plan.risk === 'high' ? '高' : '中'}。</p><p>{disclosure.impact}</p><p>{disclosure.executionNote} 计划有效至：{planExpiryLabel(plan.expiresAt)}。</p></div>}</div><div className="model-draft-actions">{!plan ? <><button className="btn btn-primary" disabled={!actions.includes('warmup')} onClick={() => void planManagedAction(entry.id, 'warmup')}>启动 / 预热</button><button className="btn btn-secondary" disabled={!actions.includes('restart')} onClick={() => void planManagedAction(entry.id, 'restart')}>重启</button><button className="btn btn-secondary" disabled={!actions.includes('stop')} onClick={() => void planManagedAction(entry.id, 'stop')}>停止</button></> : <button className="btn btn-primary" disabled={confirmingManagedPlanId === plan.id} onClick={() => void confirmManagedAction(entry.id)}>{confirmingManagedPlanId === plan.id ? '正在提交操作…' : '确认并执行'}</button>}</div></article>})}</div> : <div className="model-catalog-empty"><strong>尚无已管理服务</strong><span>当前草稿仍处于本地配置阶段。完成后续的受控登记流程前，产品不会把任何模型显示为可启动或可调参。</span></div>}
    </section>}

    {tab === 'parameters' && <section className="settings-card full-width">
      <p className="eyebrow">按服务查看</p><h3 className="card-title">模型参数</h3><p className="subtitle">先选择服务。仅显示已验证的白名单读取参数；任何修改、应用或回滚仍需后续独立的受控流程。</p>
      <label className="form-label" htmlFor="parameter-target">服务</label><select id="parameter-target" className="form-select" value={parameterTarget} onChange={(event) => void selectParameterTarget(event.target.value)}><option value="">请选择服务</option><option value="builtin-nvfp4">NVFP4（既有服务）</option><option value="builtin-vlm">VLM（既有服务）</option><option value="builtin-image">图像工作流（既有服务）</option>{drafts.filter((item) => item.status === 'registered').map((item) => <option key={item.id} value={`managed-${item.id}`}>{item.displayName}（已管理服务）</option>)}</select>
      {parameterTarget === 'builtin-nvfp4' && <div className="model-parameter-panel"><h4>NVFP4 当前参数与调整建议</h4>{parametersLoading ? <p>正在读取参数…</p> : nvfp4Parameters && nvfp4Draft ? <><dl className="parameter-summary"><dt>KV Cache</dt><dd>{nvfp4Parameters.kvCacheDtype ?? '未报告'}</dd><dt>前缀缓存</dt><dd>{nvfp4Parameters.prefixCaching === null ? '未报告' : nvfp4Parameters.prefixCaching ? '启用' : '禁用'}</dd></dl><div className="parameter-editor-grid">{nvfp4ParameterGuidance.map((field) => <label key={field.key} className="parameter-editor-field"><span>{field.label}</span><small>建议范围：{field.min}–{field.max}<br />{field.note}</small><input type="number" min={field.min} max={field.max} step={field.step} value={nvfp4Draft[field.key]} onChange={(event) => setNvfp4Draft((current) => current ? { ...current, [field.key]: event.target.value } : current)} /><em>当前报告值：{nvfp4Parameters[field.key] ?? '未报告'}</em></label>)}</div><div className="parameter-adapter-status"><strong>固定参数适配器</strong>{parameterAdapter?.installed ? <p>已部署并通过摘要校验（{parameterAdapter.version}）。当前版本只开放参数审查；真实写入、重启与回滚仍未启用。</p> : parameterAdapterPlan ? <><p>部署计划已创建。确认后只会写入固定适配器资产，不会修改模型参数或模型状态。</p><button className="btn btn-primary" disabled={deployingParameterAdapter} onClick={() => void confirmParameterAdapterDeployment()}>{deployingParameterAdapter ? '正在部署…' : '确认部署固定适配器'}</button></> : <><p>尚未检测到经过校验的固定参数适配器。部署后仍需单独完成写入适配器审计与授权。</p><button className="btn btn-secondary" disabled={deployingParameterAdapter || parameterAdapter?.unavailable} onClick={() => void createParameterAdapterDeploymentPlan()}>{deployingParameterAdapter ? '正在创建计划…' : '创建适配器部署计划'}</button></>}</div><button className="btn btn-secondary" disabled={reviewingParameters} onClick={() => void reviewParameterDraft()}>{reviewingParameters ? '正在创建审查…' : '创建参数调整审查'}</button>{parameterReview && <div className="parameter-review"><strong>参数差异预览（未执行）</strong>{parameterReview.review.changes.length ? <ul>{parameterReview.review.changes.map((change) => <li key={change.field}>{change.field}：{String(change.from)} → {String(change.to)}；需要重启</li>)}</ul> : <p>没有有效差异。</p>}<p>审计编号：{parameterReview.audit.changeId}<br />快照校验：{parameterReview.audit.scriptHash}<br />状态：仅审查，未执行。</p></div>}<p className="parameter-boundary">此操作只在本机创建带快照校验的参数差异审查和审计记录。固定适配器当前只提供快照读取；不会修改 DGX 配置、不会重启服务，也不会启动模型。</p></> : <p>尚未读取到参数。</p>}</div>}
      {parameterTarget === 'builtin-vlm' && <div className="model-catalog-empty"><strong>VLM 暂未开放参数</strong><span>当前没有经过验证的 VLM 参数合同，因此不会展示或保存通用参数。</span></div>}
      {parameterTarget === 'builtin-image' && <div className="model-catalog-empty"><strong>图像工作流暂未开放参数</strong><span>当前没有经过验证的图像工作流参数合同，因此不会展示或保存通用参数。</span></div>}
      {parameterTarget.startsWith('managed-') && <div className="model-catalog-empty">{(() => { const contract = managedParameterContract(parameterTarget); return contract?.parameters?.length ? <><strong>已声明参数合同</strong><span>适配器 {contract.id} {contract.version} 声明了以下参数范围；当前版本仅展示合同，尚未提供写入入口。</span><ul className="adapter-parameter-contract">{contract.parameters.map((item) => <li key={item.id}>{item.id}：{item.type === 'boolean' ? '布尔值' : `${item.minimum}–${item.maximum}，步长 ${item.step}`}；风险：{item.risk === 'high' ? '高' : '中'}</li>)}</ul></> : <><strong>该已管理服务暂未开放参数</strong><span>服务已完成登记，但其固定适配器尚未声明可调参数白名单。不会为未声明的参数提供编辑入口。</span></> })()}</div>}
    </section>}
    {tab === 'parameters' && parameterTarget === 'builtin-nvfp4' && parameterAdapter?.installed && <section className="settings-card full-width parameter-review"><h4>受控写入与回滚</h4><p>写入仅更新固定 NVFP4 启动参数并建立私有备份；不会自动启动、停止或重启模型。</p>{parameterPlan ? <><p>{parameterPlan.summary}</p><button className="btn btn-primary" disabled={parameterBusy} onClick={() => void (parameterPlan.action === 'apply' ? confirmParameterApplyPlan() : confirmRollbackPlan())}>{parameterBusy ? '正在执行…' : parameterPlan.action === 'apply' ? '确认写入启动参数（不重启）' : '确认恢复备份（不重启）'}</button></> : parameterOperation?.action === 'applied-pending-restart' ? <><p>{parameterOperation.message}</p><button className="btn btn-secondary" disabled={parameterBusy} onClick={() => void createRollbackPlan()}>创建恢复备份计划</button></> : <button className="btn btn-primary" disabled={parameterBusy || !parameterReview?.review.changes.length} onClick={() => void createParameterApplyPlan()}>{parameterBusy ? '正在创建计划…' : '创建参数写入计划'}</button>}</section>}
  </div>
}

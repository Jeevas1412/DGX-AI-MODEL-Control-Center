import { randomUUID } from 'node:crypto';
import { buildSnapshot } from './snapshot.mjs';
import { createBenchmarkHistoryProvider } from './benchmark-history.mjs';
import { newOpenSshAliasProfile } from './connection-profile.mjs';
import { publicCapabilities } from './capability-discovery.mjs';
import { MODEL_SERVICE_TEMPLATES } from './model-service-templates.mjs';
import { reviewNvfp4Change } from './change-policy.mjs';
import { createChangeAuditRecord } from './change-audit.mjs';
import { requireFreshVerifiedProfile } from './verified-operation-context.mjs';

const LOG_SERVICES = new Set(['nvfp4', 'vlm', 'image', '8091', '8092', '8093']);

function result(status, payload, extra = {}) {
  return Object.freeze({ status, payload: Object.freeze(payload), ...extra });
}

function error(status, message, extra = {}) {
  const { code = status === 503 ? 'DEPENDENCY_UNAVAILABLE' : status === 404 ? 'NOT_FOUND' : status === 403 ? 'OPERATION_NOT_ENABLED' : 'REQUEST_REJECTED', ...rest } = extra;
  const requestId = randomUUID().slice(0, 12);
  return result(status, { error: message, code, message, requestId }, rest);
}

function object(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value;
}

function exactBody(value, allowedKeys, message) {
  const body = object(value, message);
  if (Object.keys(body).some((key) => !allowedKeys.includes(key))) throw new Error(message);
  return body;
}

function parseLines(value) {
  if (value === null || value === '') return 200;
  const lines = Number(value);
  return Number.isInteger(lines) && lines >= 1 && lines <= 500 ? lines : null;
}

function defaultCapabilities() {
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    connection: 'not-configured',
    capabilities: {
      monitoring: 'unknown',
    },
  };
}

function disabledLocalControl() {
  return { enabled: false, localOnly: true, services: [], actions: [] };
}

function runtimeKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase().replace(/^nvidia[-_]/, '').replace(/[^a-z0-9]/g, '');
  return normalized.length >= 6 ? normalized : null;
}

/** Runtime attribution is display-only. It never grants control authority. */
function observedModelRuntime(entry, snapshot) {
  const expected = runtimeKey(entry?.displayName);
  const runtimes = snapshot?.system?.modelRuntimes ?? snapshot?.system?.vllmRuntimes;
  if (!expected || !Array.isArray(runtimes)) return null;
  const match = runtimes.find((item) => runtimeKey(item?.modelId) === expected
    && Number.isFinite(item?.usedMiB) && item.usedMiB >= 0);
  return match ? Object.freeze({ usedMiB: match.usedMiB }) : null;
}

/**
 * Deliberately small public contract for the future RDP adapter.  The
 * renderer must be able to distinguish an unconfigured installation from an
 * unreachable DGX without exposing an address, account, command, certificate
 * or service-manager output.  The initial implementation is read-only.
 */
function remoteDesktopNotConfigured() {
  return Object.freeze({
    state: 'not-configured',
    checkedAt: new Date().toISOString(),
    service: 'unknown',
    listener: 'unknown',
    nla: 'unknown',
    management: 'not-configured',
    nextStep: '请先完成 DGX 远程桌面受控部署。部署前不会生成或保存远程桌面凭据。',
  });
}

function genericServicePrecheck({ entry, template, adapter, snapshot }) {
  const checks = [{ id: 'connection', status: 'passed', message: '已验证当前连接。' }, {
    id: 'model', status: 'passed', message: `模型“${entry.displayName}”已绑定到当前已验证目标。`,
  }];
  if (!template) {
    checks.push({ id: 'adapter', status: 'failed', message: '服务模板不可用。' });
    return { eligible: false, registrationEligible: false, checks, nextStep: '请选择受产品支持的服务模板。' };
  }
  if (!adapter) {
    checks.push({ id: 'adapter', status: 'blocked', message: '尚未安装与该模板兼容且完整性通过的固定服务适配器。' });
    checks.push({ id: 'resources', status: 'blocked', message: '适配器尚未通过验证，暂不进行资源评估。' });
    return { eligible: false, registrationEligible: false, checks, nextStep: '需要通过产品部署并验证兼容的固定服务适配器后，才能创建受控登记计划。' };
  }
  checks.push({ id: 'adapter', status: 'passed', message: `已验证固定服务适配器（${adapter.version}）。` });
  const allocatableMiB = snapshot?.system?.modelMemoryBudget?.allocatableMiB;
  const queueDepth = snapshot?.system?.queueDepth;
  if (!Number.isFinite(allocatableMiB)) {
    checks.push({ id: 'resources', status: 'blocked', message: '无法读取当前可安全分配资源；不会依据过期或缺失数据登记服务。' });
    // The adapter remains verified even when a *startup* precheck cannot be
    // completed.  Stop/restart use the same fixed adapter and must not be
    // misreported as unsupported merely because the running model currently
    // occupies the resources that it will release during its restart.
    return { eligible: false, registrationEligible: true, adapter, checks, nextStep: '适配器可登记；请恢复只读资源快照后再尝试启动或预热。' };
  }
  if (adapter.resourceBudget.estimatedMemoryMiB > allocatableMiB) {
    checks.push({ id: 'resources', status: 'blocked', message: `适配器预计需要 ${adapter.resourceBudget.estimatedMemoryMiB} MiB，当前可安全分配为 ${Math.floor(allocatableMiB)} MiB。` });
    return { eligible: false, registrationEligible: true, adapter, checks, nextStep: '适配器可登记；释放资源后重新检查，才可启动或预热。' };
  }
  checks.push({ id: 'resources', status: 'passed', message: `预计需要 ${adapter.resourceBudget.estimatedMemoryMiB} MiB，当前可安全分配 ${Math.floor(allocatableMiB)} MiB。` });
  if (Number.isFinite(queueDepth) && queueDepth > 0) {
    checks.push({ id: 'queue', status: 'blocked', message: `当前存在 ${Math.floor(queueDepth)} 个排队请求；为避免影响现有工作，暂不登记。` });
    return { eligible: false, registrationEligible: true, adapter, checks, nextStep: '适配器可登记；等待队列清空后重新检查，才可启动或预热。' };
  }
  checks.push({ id: 'queue', status: 'passed', message: '当前没有排队请求。' });
  return { eligible: true, registrationEligible: true, adapter, checks, nextStep: '可创建受控登记计划；计划确认前会重新验证适配器、资源和目标。' };
}

function publicProfile(profile) {
  return {
    ...profile,
    verification: {
      status: profile.verification.status,
      verifiedAt: profile.verification.verifiedAt,
    },
  };
}

function publicProfileDocument(document) {
  return {
    schemaVersion: document.schemaVersion,
    activeProfileId: document.activeProfileId,
    profiles: document.profiles.map(publicProfile),
  };
}

/**
 * Transport-independent application contract.
 *
 * Adapters validate their own trust boundary (HTTP auth/CORS or Electron IPC
 * sender/allowlist) before calling dispatch. This core contains no listener,
 * token, CORS, socket or SSH implementation; those are injected providers.
 */
export function createApplicationCore({
  snapshotProvider = buildSnapshot,
  logProvider,
  capabilityProvider,
  profileStore = null,
  profileVerifier = null,
  benchmarkProvider = createBenchmarkHistoryProvider(),
  modelCatalog = null,
  modelSearchProvider = null,
  modelServiceRegistry = null,
  modelServiceAdapterDiscovery = null,
  modelServiceRegistrar = null,
  modelServiceExecutor = null,
  externalRuntimeCoordinator = null,
  localControl = null,
  changeAuditStore = null,
  nvfp4ParameterAdapter = null,
  nvfp4ParameterControl = null,
  connectionStatusProvider = null,
  remoteDesktopStatusProvider = null,
  hardwareSnapshotProvider = null,
  hardwareHistoryStore = null,
} = {}) {
  const registrationPlans = new Map();
  const managedServicePlans = new Map();
  const parameterAdapterDeploymentPlans = new Map();
  const externalRuntimePlans = new Map();

  /**
   * Registered services are part of the product service inventory even when
   * their adapter does not expose a runtime health probe yet.  Keeping them in
   * the same response as built-in services prevents a clean installation from
   * presenting an empty overview after the user has completed registration.
   * This deliberately exposes neither an invented port nor a guessed running
   * state: `registered` means exactly that the service is controllable through
   * a verified adapter, not that it has been started.
   */
  async function managedServiceInventory(snapshot) {
    if (!modelServiceRegistry || !profileStore) return [];
    const document = await profileStore.load();
    const active = document.profiles.find((item) => item.id === document.activeProfileId);
    const target = active?.verification?.status === 'verified'
      ? active.verification.evidence?.targetMachineSha256
      : null;
    if (!target) return [];
    const entries = (await modelServiceRegistry.loadForTarget(target)).entries
      .filter((item) => item.status === 'registered');
    let adapters = [];
    try { adapters = modelServiceAdapterDiscovery ? await modelServiceAdapterDiscovery() : []; } catch { /* Keep inventory available when a read-only probe is temporarily unavailable. */ }
    return Promise.all(entries.map(async (entry) => {
      const adapter = adapters.find((item) => item.id === entry.adapterId
        && item.version === entry.adapterVersion
        && item.integritySha256 === entry.adapterIntegritySha256);
      const template = MODEL_SERVICE_TEMPLATES.find((item) => item.id === entry.templateId);
      const runtime = observedModelRuntime(entry, snapshot);
      return Object.freeze({
        id: `managed-${entry.id}`,
        managedServiceId: entry.id,
        name: entry.displayName,
        type: template?.kind ?? 'generic',
        status: runtime ? 'running' : adapter ? 'registered' : 'adapter-unavailable',
        port: null,
        uptimeSeconds: null,
        observedMemoryMiB: runtime?.usedMiB ?? null,
        estimatedMemoryMiB: adapter?.resourceBudget?.estimatedMemoryMiB ?? null,
        estimateSource: adapter?.resourceBudget?.basis === 'measured-profile' ? 'measured-profile' : adapter ? 'adapter-reservation' : null,
        estimatedMemoryBaselineMiB: adapter?.resourceBudget?.observedMemoryMiB ?? null,
        startupBufferMiB: adapter?.resourceBudget?.startupBufferMiB ?? null,
        residency: runtime ? 'resident' : 'on-demand',
        control: 'managed',
        adapter: adapter ? { id: adapter.id, version: adapter.version } : null,
        managedActions: adapter ? adapter.actions : [],
      });
    }));
  }

  async function currentModelServicePrecheck(configurationId) {
    if (!modelServiceRegistry) return error(503, 'Model service configuration is unavailable.');
    const document = await profileStore?.load();
    const active = document?.profiles?.find((item) => item.id === document.activeProfileId);
    try {
      // Managed model actions are remote control, not read-only monitoring.
      // Reuse the same bounded verification TTL as the fixed control
      // controller so an expired profile cannot leave a plan that later
      // appears actionable while confirmation is guaranteed to fail.
      requireFreshVerifiedProfile(active);
    } catch (cause) {
      return error(409, cause instanceof Error ? cause.message : 'A fresh verified active connection is required.', {
        code: cause?.code === 'PROFILE_REVERIFY_REQUIRED' ? cause.code : 'PROFILE_REVERIFY_REQUIRED',
      });
    }
    const target = active?.verification?.status === 'verified' ? active.verification.evidence?.targetMachineSha256 : null;
    if (!target) return error(409, 'A verified active connection is required.', { code: 'PROFILE_REVERIFY_REQUIRED' });
    const entry = (await modelServiceRegistry.loadForTarget(target)).entries.find((item) => item.id === configurationId);
    if (!entry) return error(404, 'Model service configuration was not found.');
    const catalogEntry = modelCatalog ? (await modelCatalog.loadForTarget(target)).entries.find((item) => item.id === entry.catalogEntryId) : null;
    const template = MODEL_SERVICE_TEMPLATES.find((item) => item.id === entry.templateId);
    let adapters;
    try { adapters = modelServiceAdapterDiscovery ? await modelServiceAdapterDiscovery() : []; }
    catch { return error(503, 'Model service adapter discovery is unavailable.'); }
    const adapter = entry.status === 'registered'
      ? adapters.find((item) => item.id === entry.adapterId && item.version === entry.adapterVersion && item.integritySha256 === entry.adapterIntegritySha256)
      : adapters.find((item) => item.templateId === entry.templateId
        && (!Array.isArray(item.modelIds)
          || (typeof catalogEntry?.modelId === 'string' && item.modelIds.includes(catalogEntry.modelId))));
    let snapshot = null;
    if (adapter) {
      try { snapshot = await snapshotProvider(); } catch { snapshot = null; }
    }
    const generic = genericServicePrecheck({ entry, template, adapter, snapshot });
    // Restart only releases capacity first when this exact registered model is
    // actually present in the same read-only runtime snapshot.  An unloaded
    // service's restart is a start and must pass the startup resource gate.
    const runtimeLoaded = Boolean(observedModelRuntime(entry, snapshot));
    return result(200, { configurationId: entry.id, entry, runtimeLoaded, ...generic });
  }

  async function dispatch(input) {
    const request = object(input, 'Application request must be an object.');
    const method = request.method;
    if (method !== 'GET' && method !== 'POST') return error(405, 'This API is read-only.', { allow: 'GET' });

    let url;
    try {
      url = new URL(request.path, 'http://application.local');
      if (url.origin !== 'http://application.local' || !url.pathname.startsWith('/api/')) throw new Error();
    } catch {
      return error(404, 'Not found');
    }

    if (url.pathname === '/api/setup/profiles') {
      if (!profileStore) return error(503, 'Connection profile storage is unavailable.');
      if (method === 'GET') return result(200, publicProfileDocument(await profileStore.load()));
      try {
        const body = exactBody(request.body, ['displayName', 'hostKeyFingerprint', 'sshAlias'], 'Unsupported connection profile fields.');
        const profile = newOpenSshAliasProfile(body);
        const document = await profileStore.upsert(profile);
        return result(201, { profile: publicProfile(document.profiles.find((item) => item.id === profile.id)) });
      } catch (cause) {
        return error(400, cause instanceof Error ? cause.message : 'Connection profile is invalid.');
      }
    }

    const verify = url.pathname.match(/^\/api\/setup\/profiles\/([a-z0-9][a-z0-9-]{0,63})\/verify$/);
    if (verify) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!profileStore) return error(503, 'Connection profile storage is unavailable.');
      try {
        if (Object.keys(exactBody(request.body, [], 'Connection verification body must be empty.')).length !== 0) {
          throw new Error('Connection verification body must be empty.');
        }
        const document = await profileStore.load();
        const profile = document.profiles.find((item) => item.id === verify[1]);
        if (!profile) return error(404, 'Connection profile was not found.');
        if (!profileVerifier) return error(503, 'Connection verification is unavailable.');
        const verificationResult = await profileVerifier(profile);
        if (verificationResult?.connection !== 'reachable') return error(503, 'Connection verification is unavailable.');
        if (profile.hostKeyFingerprint !== null && (!Array.isArray(verificationResult.trustedHostKeyFingerprints) || !verificationResult.trustedHostKeyFingerprints.includes(profile.hostKeyFingerprint))) {
          return error(409, 'Configured SSH host key fingerprint does not match the trusted host key.');
        }
        await profileStore.markVerified(profile.id, verificationResult.verificationEvidence);
        const { trustedHostKeyFingerprints: _trustedHostKeyFingerprints, ...publicResult } = verificationResult;
        const safeResult = publicCapabilities(publicResult);
        return result(200, { profileId: profile.id, result: safeResult });
      } catch {
        return error(503, 'Connection verification is unavailable.');
      }
    }

    const activate = url.pathname.match(/^\/api\/setup\/profiles\/([a-z0-9][a-z0-9-]{0,63})\/activate$/);
    if (activate) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!profileStore) return error(503, 'Connection profile storage is unavailable.');
      try {
        if (Object.keys(exactBody(request.body, [], 'Connection activation body must be empty.')).length !== 0) {
          throw new Error('Connection activation body must be empty.');
        }
        const document = await profileStore.activate(activate[1]);
        return result(200, { activeProfileId: document.activeProfileId });
      } catch (cause) {
        return error(400, cause instanceof Error ? cause.message : 'Connection activation is invalid.');
      }
    }

    if (url.pathname === '/api/setup/capabilities') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      try {
        return result(200, publicCapabilities(await (capabilityProvider?.() ?? Promise.resolve(defaultCapabilities()))));
      } catch {
        return error(503, 'Capability discovery is unavailable.');
      }
    }

    if (url.pathname === '/api/benchmarks') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      try {
        return result(200, { generatedAt: new Date().toISOString(), items: await benchmarkProvider() });
      } catch (cause) {
        return error(503, cause instanceof Error ? `Benchmark history is unavailable. ${cause.message}` : 'Benchmark history is unavailable.');
      }
    }

    if (url.pathname === '/api/model-catalog') {
      if (!modelCatalog) return error(503, 'Model catalog is unavailable.');
      if (method === 'GET') {
        const document = await profileStore?.load();
        const active = document?.profiles?.find((item) => item.id === document.activeProfileId);
        const target = active?.verification?.status === 'verified' ? active.verification.evidence?.targetMachineSha256 : null;
        if (!target || typeof modelCatalog.loadForTarget !== 'function') return result(200, { schemaVersion: 3, entries: [] });
        return result(200, await modelCatalog.loadForTarget(target));
      }
      try {
        if (!modelSearchProvider || typeof modelSearchProvider.consume !== 'function') throw new Error('Verified DGX model discovery is unavailable.');
        const body = exactBody(request.body, ['resultId'], 'Model catalog requires a verified discovery result.');
        return result(201, { entry: await modelCatalog.add(await modelSearchProvider.consume(body.resultId)) });
      } catch (cause) { return error(400, cause instanceof Error ? cause.message : 'Model catalog entry is invalid.'); }
    }

    if (url.pathname === '/api/model-catalog/search') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      if (!modelSearchProvider) return error(503, 'Public model search is unavailable.');
      try {
        if ([...url.searchParams.keys()].some((key) => key !== 'q')) throw new Error('Unsupported model search query.');
        const search = typeof modelSearchProvider === 'function' ? modelSearchProvider : modelSearchProvider.search;
        if (typeof search !== 'function') throw new Error('Verified DGX model search is unavailable.');
        return result(200, { items: await search(url.searchParams.get('q') ?? '') });
      } catch (cause) { return error(400, cause instanceof Error ? cause.message : 'Public model search is unavailable.'); }
    }

    if (url.pathname === '/api/model-service-templates') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      return result(200, { items: MODEL_SERVICE_TEMPLATES });
    }

    if (url.pathname === '/api/model-service-adapters') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      try { return result(200, { items: modelServiceAdapterDiscovery ? await modelServiceAdapterDiscovery() : [] }); }
      catch { return error(503, 'Model service adapter discovery is unavailable.'); }
    }

    if (url.pathname === '/api/model-service-configurations') {
      if (!modelServiceRegistry || !modelCatalog) return error(503, 'Model service configuration is unavailable.');
      const document = await profileStore?.load();
      const active = document?.profiles?.find((item) => item.id === document.activeProfileId);
      const target = active?.verification?.status === 'verified' ? active.verification.evidence?.targetMachineSha256 : null;
      if (!target) return error(409, 'A verified active connection is required.', { code: 'PROFILE_REVERIFY_REQUIRED' });
      if (method === 'GET') return result(200, await modelServiceRegistry.loadForTarget(target));
      try {
        const body = exactBody(request.body, ['catalogEntryId', 'templateId', 'displayName'], 'Unsupported model service configuration fields.');
        const catalog = await modelCatalog.loadForTarget(target);
        if (!catalog.entries.some((entry) => entry.id === body.catalogEntryId)) throw new Error('Selected model is not available for the current verified connection.');
        return result(201, { entry: await modelServiceRegistry.addDraft({ ...body, targetMachineSha256: target }) });
      } catch (cause) { return error(400, cause instanceof Error ? cause.message : 'Model service configuration is invalid.'); }
    }
    const modelServicePrecheck = url.pathname.match(/^\/api\/model-service-configurations\/([a-f0-9-]{36})\/precheck$/);
    if (modelServicePrecheck) {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      const checked = await currentModelServicePrecheck(modelServicePrecheck[1]);
      if (checked.status !== 200) return checked;
      const { entry, ...payload } = checked.payload;
      return result(200, payload);
    }

    const modelServiceRegistrationPlan = url.pathname.match(/^\/api\/model-service-configurations\/([a-f0-9-]{36})\/registration-plans$/);
    if (modelServiceRegistrationPlan) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      try {
        if (Object.keys(exactBody(request.body, [], 'Registration plan body must be empty.')).length !== 0) throw new Error('Registration plan body must be empty.');
        const checked = await currentModelServicePrecheck(modelServiceRegistrationPlan[1]);
        if (checked.status !== 200) return checked;
        if (!checked.payload.registrationEligible) return error(409, 'Model service registration precheck is not satisfied.', { code: 'REGISTRATION_PRECHECK_BLOCKED' });
        const createdAt = new Date().toISOString();
        const plan = Object.freeze({
          id: randomUUID(), configurationId: checked.payload.configurationId, action: 'register-managed-service', risk: 'high',
          summary: `将为“${checked.payload.entry.displayName}”创建受管服务登记。确认阶段会再次验证目标、适配器、资源与队列；本计划本身不会写入 DGX。`,
          createdAt, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), status: 'awaiting-confirmation',
          binding: Object.freeze({ targetMachineSha256: checked.payload.entry.targetMachineSha256, adapterId: checked.payload.adapter.id, adapterVersion: checked.payload.adapter.version, adapterIntegritySha256: checked.payload.adapter.integritySha256 }),
        });
        registrationPlans.set(plan.id, plan);
        return result(201, { plan });
      } catch (cause) { return error(400, cause instanceof Error ? cause.message : 'Model service registration plan is invalid.'); }
    }

    const modelServiceRegistrationConfirm = url.pathname.match(/^\/api\/model-service-registration-plans\/([a-f0-9-]{36})\/confirm$/);
    if (modelServiceRegistrationConfirm) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      try {
        if (Object.keys(exactBody(request.body, [], 'Registration confirmation body must be empty.')).length !== 0) throw new Error('Registration confirmation body must be empty.');
        const plan = registrationPlans.get(modelServiceRegistrationConfirm[1]);
        if (!plan) return error(404, 'Model service registration plan was not found.');
        if (Date.now() >= Date.parse(plan.expiresAt)) { registrationPlans.delete(plan.id); return error(409, 'Model service registration plan has expired.', { code: 'REGISTRATION_PLAN_EXPIRED' }); }
        if (!modelServiceRegistrar) return error(503, 'Managed service registration is unavailable.');
        const checked = await currentModelServicePrecheck(plan.configurationId);
        if (checked.status !== 200) return checked;
        if (!checked.payload.registrationEligible) return error(409, 'Model service registration precheck is not satisfied.', { code: 'REGISTRATION_PRECHECK_BLOCKED' });
        const adapter = checked.payload.adapter;
        if (checked.payload.entry.targetMachineSha256 !== plan.binding.targetMachineSha256 || adapter.id !== plan.binding.adapterId || adapter.version !== plan.binding.adapterVersion || adapter.integritySha256 !== plan.binding.adapterIntegritySha256) return error(409, 'The verified adapter or connection changed. Create a new registration plan.', { code: 'REGISTRATION_BINDING_CHANGED' });
        const remote = await modelServiceRegistrar.register({ configurationId: checked.payload.entry.id, catalogEntryId: checked.payload.entry.catalogEntryId, targetMachineSha256: checked.payload.entry.targetMachineSha256, templateId: checked.payload.entry.templateId, displayName: checked.payload.entry.displayName, adapter });
        const entry = await modelServiceRegistry.markRegistered({ id: checked.payload.entry.id, adapterId: adapter.id, adapterVersion: adapter.version, adapterIntegritySha256: adapter.integritySha256, remoteRegistrationId: remote.registrationId });
        registrationPlans.delete(plan.id);
        return result(201, { entry, remoteStatus: remote.status });
      } catch (cause) { return error(503, cause instanceof Error ? cause.message : 'Managed service registration is unavailable.'); }
    }

    const managedServicePlan = url.pathname.match(/^\/api\/managed-services\/([a-f0-9-]{36})\/plans$/);
    if (managedServicePlan) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      try {
        const body = exactBody(request.body, ['action'], 'Managed service action is invalid.');
        if (!['warmup', 'restart', 'stop'].includes(body.action)) throw new Error('Managed service action is invalid.');
        const checked = await currentModelServicePrecheck(managedServicePlan[1]);
        if (checked.status !== 200) return checked;
        const entry = checked.payload.entry;
        if (entry.status !== 'registered') return error(409, 'Managed service registration is required.', { code: 'SERVICE_NOT_REGISTERED' });
        const adapter = checked.payload.adapter;
        if (!adapter?.actions?.includes(body.action)) return error(409, 'The verified adapter does not support this action.', { code: 'ADAPTER_ACTION_UNAVAILABLE' });
        // A positive runtime observation means warmup has already succeeded.
        // Refuse the duplicate start explicitly instead of falling through to
        // a capacity gate that makes the loaded state look like a failure.
        if (body.action === 'warmup' && checked.payload.runtimeLoaded) {
          return error(409, 'The managed model is already loaded. Use restart or stop if a state change is required.', { code: 'SERVICE_ALREADY_LOADED' });
        }
        // An unloaded restart is another form of startup. Only a restart of a
        // runtime observed in this snapshot may rely on releasing its own
        // memory first; stop never needs a startup capacity check.
        const requiresStartupPrecheck = body.action === 'warmup' || (body.action === 'restart' && !checked.payload.runtimeLoaded);
        if (requiresStartupPrecheck && !checked.payload.eligible) return error(409, 'Managed service startup precheck is not satisfied.', { code: 'STARTUP_PRECHECK_BLOCKED' });
        const summary = body.action === 'warmup'
          ? `将启动/预热“${entry.displayName}”。适配器如声明独占运行，可能停止其他 LLM。`
          : body.action === 'restart'
            ? `将重启“${entry.displayName}”。适配器如声明独占运行，可能停止其他 LLM。`
            : `将停止“${entry.displayName}”。不会启动其他模型。`;
        const plan = Object.freeze({ id: randomUUID(), serviceId: entry.id, action: body.action, risk: 'high', summary, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), status: 'awaiting-confirmation', binding: Object.freeze({ adapterId: adapter.id, adapterVersion: adapter.version, adapterIntegritySha256: adapter.integritySha256 }) });
        managedServicePlans.set(plan.id, plan); return result(201, { plan });
      } catch (cause) { return error(400, cause instanceof Error ? cause.message : 'Managed service action is invalid.'); }
    }
    const managedServiceConfirm = url.pathname.match(/^\/api\/managed-service-plans\/([a-f0-9-]{36})\/confirm$/);
    if (managedServiceConfirm) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      try {
        if (Object.keys(exactBody(request.body, [], 'Managed service confirmation body must be empty.')).length !== 0) throw new Error('Managed service confirmation body must be empty.');
        const plan = managedServicePlans.get(managedServiceConfirm[1]);
        if (!plan) return error(404, 'Managed service plan was not found.');
        if (Date.now() >= Date.parse(plan.expiresAt)) { managedServicePlans.delete(plan.id); return error(409, 'Managed service plan has expired.', { code: 'MANAGED_SERVICE_PLAN_EXPIRED' }); }
        if (!modelServiceExecutor) return error(503, 'Managed service execution is unavailable.');
        const checked = await currentModelServicePrecheck(plan.serviceId); if (checked.status !== 200) return checked;
        const adapter = checked.payload.adapter; if (!adapter || adapter.id !== plan.binding.adapterId || adapter.version !== plan.binding.adapterVersion || adapter.integritySha256 !== plan.binding.adapterIntegritySha256) return error(409, 'The verified adapter changed. Create a new plan.', { code: 'MANAGED_SERVICE_BINDING_CHANGED' });
        if (plan.action === 'warmup' && checked.payload.runtimeLoaded) return error(409, 'The managed model is already loaded. Create a restart or stop plan if a state change is required.', { code: 'SERVICE_ALREADY_LOADED' });
        const requiresStartupPrecheck = plan.action === 'warmup' || (plan.action === 'restart' && !checked.payload.runtimeLoaded);
        if (requiresStartupPrecheck && !checked.payload.eligible) return error(409, 'Managed service startup precheck is not satisfied.', { code: 'STARTUP_PRECHECK_BLOCKED' });
        await modelServiceExecutor({ adapterId: adapter.id, action: plan.action }); managedServicePlans.delete(plan.id);
        return result(202, { serviceId: plan.serviceId, action: plan.action, status: 'submitted', message: '已提交固定适配器操作；请刷新服务状态确认结果。' });
      } catch (cause) { return error(503, cause instanceof Error ? cause.message : 'Managed service execution is unavailable.'); }
    }

    if (url.pathname === '/api/external-runtime-services') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      if (!externalRuntimeCoordinator) return result(200, { items: [] });
      try { return result(200, { items: await externalRuntimeCoordinator.list() }); }
      catch (cause) { return error(503, cause instanceof Error ? cause.message : 'External runtime discovery is unavailable.'); }
    }
    const externalRuntimePlan = url.pathname.match(/^\/api\/external-runtime-services\/(runtime-[a-f0-9]{32})\/plans$/);
    if (externalRuntimePlan) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!externalRuntimeCoordinator) return error(403, 'External runtime coordination is disabled.');
      try {
        const body = exactBody(request.body, ['action'], 'External runtime action is invalid.');
        if (!['suspend', 'resume'].includes(body.action)) throw new Error('External runtime action is invalid.');
        const plan = await externalRuntimeCoordinator.plan({ runtimeId: externalRuntimePlan[1], action: body.action });
        externalRuntimePlans.set(plan.id, plan); return result(201, { plan });
      } catch (cause) { return error(400, cause instanceof Error ? cause.message : 'External runtime plan is invalid.'); }
    }
    const externalRuntimeConfirm = url.pathname.match(/^\/api\/external-runtime-plans\/([a-f0-9-]{36})\/confirm$/);
    if (externalRuntimeConfirm) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!externalRuntimeCoordinator) return error(403, 'External runtime coordination is disabled.');
      try {
        if (Object.keys(exactBody(request.body, [], 'External runtime confirmation body must be empty.')).length !== 0) throw new Error('External runtime confirmation body must be empty.');
        const plan = externalRuntimePlans.get(externalRuntimeConfirm[1]);
        if (!plan) return error(404, 'External runtime plan was not found.');
        const outcome = await externalRuntimeCoordinator.confirm(plan); externalRuntimePlans.delete(plan.id);
        return result(202, { outcome, message: plan.action === 'suspend' ? '外部模型服务已暂停并完成状态复核；请重新检查目标模型的启动条件。' : '外部模型服务已恢复并完成状态复核。' });
      } catch (cause) { return error(503, cause instanceof Error ? cause.message : 'External runtime confirmation is unavailable.'); }
    }

    if (url.pathname === '/api/local-control/capabilities') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      return result(200, localControl ? { enabled: true, localOnly: true, services: ['nvfp4', 'vlm', 'image', 'proxy-8093'], actions: ['warmup', 'restart', 'stop'] } : disabledLocalControl());
    }
    if (url.pathname === '/api/local-control/recovery-required') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      if (!localControl) return error(403, 'Local service control is disabled.');
      return result(200, { items: await localControl.listRecoveryRequired() });
    }
    if (url.pathname === '/api/local-control/plans') {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!localControl) return error(403, 'Local service control is disabled.');
      try {
        const body = exactBody(request.body, ['serviceId', 'action'], 'Unsupported control request fields.');
        if (Object.keys(body).length !== 2) throw new Error('Unsupported control request fields.');
        return result(201, await localControl.createPlan(body));
      } catch (cause) {
        return error(400, cause instanceof Error ? cause.message : 'Control plan is invalid.');
      }
    }
    const localConfirm = url.pathname.match(/^\/api\/local-control\/plans\/([a-f0-9-]{36})\/confirm$/);
    if (localConfirm) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!localControl) return error(403, 'Local service control is disabled.');
      try {
        if (Object.keys(exactBody(request.body, [], 'Control confirmation body must be empty.')).length !== 0) throw new Error('Control confirmation body must be empty.');
        return result(202, await localControl.confirmPlan(localConfirm[1]));
      } catch (cause) {
        const code = cause?.code === 'PROFILE_REVERIFY_REQUIRED' ? cause.code : 'REQUEST_REJECTED';
        return error(code === 'PROFILE_REVERIFY_REQUIRED' ? 409 : 400, cause instanceof Error ? cause.message : 'Control confirmation is invalid.', { code });
      }
    }
    const localOperation = url.pathname.match(/^\/api\/local-control\/operations\/([a-f0-9-]{36})$/);
    if (localOperation) {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      if (!localControl) return error(403, 'Local service control is disabled.');
      try {
        return result(200, localControl.getOperation(localOperation[1]));
      } catch (cause) {
        return error(404, cause instanceof Error ? cause.message : 'Control operation was not found.');
      }
    }
    const localRecovery = url.pathname.match(/^\/api\/local-control\/operations\/([a-f0-9-]{36})\/resolve-recovery$/);
    if (localRecovery) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!localControl) return error(403, 'Local service control is disabled.');
      try {
        if (Object.keys(exactBody(request.body, [], 'Local recovery body must be empty.')).length !== 0) throw new Error('Local recovery body must be empty.');
        return result(200, await localControl.resolveRecoveredOperation(localRecovery[1]));
      } catch (cause) { return error(400, cause instanceof Error ? cause.message : 'Local recovery is invalid.'); }
    }

    if (url.pathname === '/api/models/nvfp4/parameter-review') {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      try {
        const body = exactBody(request.body, ['proposed'], 'Unsupported parameter review fields.');
        const snapshot = await snapshotProvider();
        const values = snapshot?.metrics?.nvfp4?.config;
        const scriptHash = values?.integritySha256;
        if (!values || typeof values !== 'object' || typeof scriptHash !== 'string') {
          return error(409, 'A verified NVFP4 parameter snapshot is required before review.', { code: 'PARAMETER_SNAPSHOT_UNAVAILABLE' });
        }
        const { integritySha256: _integritySha256, ...current } = values;
        const review = reviewNvfp4Change({ service: 'nvfp4', current, proposed: body.proposed, snapshotId: snapshot.generatedAt, scriptHash });
        if (review.errors.length) return error(400, 'Parameter review is invalid.', { code: 'PARAMETER_REVIEW_REJECTED' });
        const audit = createChangeAuditRecord({ changeId: randomUUID(), actor: 'desktop-user', snapshotId: snapshot.generatedAt, scriptHash, review });
        if (changeAuditStore) await changeAuditStore.append(audit);
        return result(201, { review, audit });
      } catch (cause) {
        return error(400, cause instanceof Error ? cause.message : 'Parameter review is invalid.');
      }
    }

    if (url.pathname === '/api/models/nvfp4/parameter-adapter') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      if (!nvfp4ParameterAdapter) return result(200, { installed: false, unavailable: true });
      try { return result(200, await nvfp4ParameterAdapter.status()); }
      catch { return error(503, 'NVFP4 parameter adapter status is unavailable.'); }
    }
    if (url.pathname === '/api/connection-status') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      if (!connectionStatusProvider) return result(200, { status: 'not-configured', checkedAt: new Date().toISOString() });
      try { return result(200, await connectionStatusProvider()); }
      catch { return result(200, { status: 'disconnected', checkedAt: new Date().toISOString() }); }
    }

    if (url.pathname === '/api/remote-desktop/status') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      if (!remoteDesktopStatusProvider) return result(200, remoteDesktopNotConfigured());
      try { return result(200, await remoteDesktopStatusProvider()); }
      catch {
        return result(200, Object.freeze({
          state: 'unreachable', checkedAt: new Date().toISOString(), service: 'unknown', listener: 'unknown', nla: 'unknown', management: 'unknown',
          nextStep: '无法读取远程桌面状态。请先确认 DGX 连接后重试；不会自动重启或改写远程桌面服务。',
        }));
      }
    }

    if (url.pathname === '/api/hardware/history') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      if ([...url.searchParams.keys()].some((key) => key !== 'metric' && key !== 'range')) return error(404, 'Not found');
      const metric = url.searchParams.get('metric');
      const range = url.searchParams.get('range');
      if (!['gpuUtilizationPercent', 'cpuPercent', 'memoryUsedPercent', 'rootUsedPercent'].includes(metric) || !['15m', '1h', '6h', '24h', '7d'].includes(range)) {
        return error(400, 'Hardware history query is invalid.');
      }
      if (!hardwareHistoryStore) return result(200, { status: 'not-configured', metric, range, items: [] });
      try { return result(200, { status: 'healthy', metric, range, items: await hardwareHistoryStore.list({ metric, range }) }); }
      catch { return error(400, 'Hardware history query is invalid.'); }
    }

    if (url.pathname.startsWith('/api/hardware/')) {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      const knownPath = new Set(['/api/hardware/summary', '/api/hardware/gpu', '/api/hardware/storage', '/api/hardware/network', '/api/hardware/components']);
      if (!knownPath.has(url.pathname) || url.search) return error(404, 'Not found');
      if (!hardwareSnapshotProvider) return result(200, Object.freeze({
        status: 'not-configured', connection: 'not-configured', collectedAt: new Date().toISOString(), ageMs: null, source: 'unavailable',
        system: null, memory: null, gpu: null, storage: null, network: null, components: [], freshness: { state: 'not-configured', cached: false },
      }));
      try {
        const summary = await hardwareSnapshotProvider();
        try { if (hardwareHistoryStore) await hardwareHistoryStore.capture(summary); } catch { /* Monitoring data remains available if local history compaction fails. */ }
        if (url.pathname === '/api/hardware/summary') return result(200, summary);
        const key = url.pathname.split('/').at(-1);
        return result(200, Object.freeze({ status: summary.status, connection: summary.connection, collectedAt: summary.collectedAt, ageMs: summary.ageMs, source: summary.source, freshness: summary.freshness, [key]: summary[key] }));
      } catch {
        return result(200, Object.freeze({
          status: 'unavailable', connection: 'connected', collectedAt: new Date().toISOString(), ageMs: null, source: 'fixed-ssh-hardware-probe',
          system: null, memory: null, gpu: null, storage: null, network: null, components: [], freshness: { state: 'unavailable', cached: false },
        }));
      }
    }
    if (url.pathname === '/api/models/nvfp4/parameter-operations') {
      if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
      if (!nvfp4ParameterControl) return error(503, 'NVFP4 parameter control is unavailable.');
      return result(200, { items: await nvfp4ParameterControl.listOperations() });
    }
    if (url.pathname === '/api/models/nvfp4/parameter-plans') {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!nvfp4ParameterControl) return error(503, 'NVFP4 parameter control is unavailable.');
      try { const body = exactBody(request.body, ['proposed'], 'Unsupported parameter plan fields.'); return result(201, { plan: await nvfp4ParameterControl.createApplyPlan(body.proposed) }); }
      catch (cause) { return error(400, cause instanceof Error ? cause.message : 'Parameter plan is invalid.'); }
    }
    const parameterPlanConfirm = url.pathname.match(/^\/api\/models\/nvfp4\/parameter-plans\/([a-f0-9-]{36})\/confirm$/);
    if (parameterPlanConfirm) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!nvfp4ParameterControl) return error(503, 'NVFP4 parameter control is unavailable.');
      try { if (Object.keys(exactBody(request.body, [], 'Parameter plan confirmation body must be empty.')).length) throw new Error('Parameter plan confirmation body must be empty.'); return result(201, { operation: await nvfp4ParameterControl.confirmApply(parameterPlanConfirm[1]) }); }
      catch (cause) { return error(400, cause instanceof Error ? cause.message : 'Parameter plan confirmation is invalid.'); }
    }
    const parameterRollbackPlan = url.pathname.match(/^\/api\/models\/nvfp4\/parameter-operations\/([a-f0-9-]{36})\/rollback-plans$/);
    if (parameterRollbackPlan) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!nvfp4ParameterControl) return error(503, 'NVFP4 parameter control is unavailable.');
      try { if (Object.keys(exactBody(request.body, [], 'Parameter rollback plan body must be empty.')).length) throw new Error('Parameter rollback plan body must be empty.'); return result(201, { plan: await nvfp4ParameterControl.createRollbackPlan(parameterRollbackPlan[1]) }); }
      catch (cause) { return error(400, cause instanceof Error ? cause.message : 'Parameter rollback plan is invalid.'); }
    }
    const parameterRollbackConfirm = url.pathname.match(/^\/api\/models\/nvfp4\/parameter-rollback-plans\/([a-f0-9-]{36})\/confirm$/);
    if (parameterRollbackConfirm) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!nvfp4ParameterControl) return error(503, 'NVFP4 parameter control is unavailable.');
      try { if (Object.keys(exactBody(request.body, [], 'Parameter rollback confirmation body must be empty.')).length) throw new Error('Parameter rollback confirmation body must be empty.'); return result(201, { operation: await nvfp4ParameterControl.confirmRollback(parameterRollbackConfirm[1]) }); }
      catch (cause) { return error(400, cause instanceof Error ? cause.message : 'Parameter rollback confirmation is invalid.'); }
    }
    if (url.pathname === '/api/models/nvfp4/parameter-adapter/deployment-plans') {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!nvfp4ParameterAdapter) return error(503, 'NVFP4 parameter adapter deployment is unavailable.');
      try {
        if (Object.keys(exactBody(request.body, [], 'Parameter adapter deployment plan body must be empty.')).length !== 0) throw new Error('Parameter adapter deployment plan body must be empty.');
        if ((await nvfp4ParameterAdapter.status()).installed) return error(409, 'The verified NVFP4 parameter adapter is already installed.', { code: 'PARAMETER_ADAPTER_ALREADY_INSTALLED' });
        const plan = nvfp4ParameterAdapter.newDeploymentPlan();
        parameterAdapterDeploymentPlans.set(plan.id, plan);
        return result(201, { plan });
      } catch (cause) { return error(400, cause instanceof Error ? cause.message : 'Parameter adapter deployment plan is invalid.'); }
    }
    const parameterAdapterDeploymentConfirm = url.pathname.match(/^\/api\/models\/nvfp4\/parameter-adapter\/deployment-plans\/([a-f0-9-]{36})\/confirm$/);
    if (parameterAdapterDeploymentConfirm) {
      if (method !== 'POST') return error(405, 'This API is read-only.', { allow: 'POST' });
      if (!nvfp4ParameterAdapter) return error(503, 'NVFP4 parameter adapter deployment is unavailable.');
      try {
        if (Object.keys(exactBody(request.body, [], 'Parameter adapter deployment confirmation body must be empty.')).length !== 0) throw new Error('Parameter adapter deployment confirmation body must be empty.');
        const plan = parameterAdapterDeploymentPlans.get(parameterAdapterDeploymentConfirm[1]);
        if (!plan) return error(404, 'Parameter adapter deployment plan was not found.');
        if (Date.now() >= Date.parse(plan.expiresAt)) { parameterAdapterDeploymentPlans.delete(plan.id); return error(409, 'Parameter adapter deployment plan has expired.', { code: 'PARAMETER_ADAPTER_PLAN_EXPIRED' }); }
        if ((await nvfp4ParameterAdapter.status()).installed) return error(409, 'The verified NVFP4 parameter adapter is already installed.', { code: 'PARAMETER_ADAPTER_ALREADY_INSTALLED' });
        const status = await nvfp4ParameterAdapter.deploy();
        parameterAdapterDeploymentPlans.delete(plan.id);
        return result(201, { status, message: '固定参数适配器已部署并完成摘要校验；尚未写入任何模型参数。' });
      } catch (cause) { return error(503, cause instanceof Error ? cause.message : 'Parameter adapter deployment is unavailable.'); }
    }

    if (method !== 'GET') return error(405, 'This API is read-only.', { allow: 'GET' });
    let snapshot;
    try {
      snapshot = await snapshotProvider();
    } catch (cause) {
      return error(503, cause instanceof Error ? `Read-only DGX data is unavailable. ${cause.message}` : 'Read-only DGX data is unavailable.');
    }
    switch (url.pathname) {
      case '/api/health': return result(200, snapshot.health);
      case '/api/services': {
        const managed = await managedServiceInventory(snapshot);
        return result(200, { generatedAt: snapshot.generatedAt, items: [...snapshot.services, ...managed] });
      }
      case '/api/system': return result(200, snapshot.system);
      case '/api/models/nvfp4/metrics': return result(200, snapshot.metrics.nvfp4);
      case '/api/models/nvfp4/config': return result(200, { generatedAt: snapshot.generatedAt, values: snapshot.metrics.nvfp4.config || {} });
      case '/api/models/vlm/metrics': return result(200, snapshot.metrics.vlm);
      case '/api/requests': return result(200, { generatedAt: snapshot.generatedAt, items: snapshot.requests });
      case '/api/logs': {
        const service = url.searchParams.get('service') || 'nvfp4';
        const lines = parseLines(url.searchParams.get('lines'));
        if (!LOG_SERVICES.has(service)) return error(400, `Unsupported service: ${service}`);
        if (lines === null) return error(400, 'lines must be an integer between 1 and 500.');
        try {
          return result(200, { generatedAt: snapshot.generatedAt, service, requestedLines: lines, items: logProvider ? await logProvider(service, lines) : snapshot.logs.slice(-lines) });
        } catch (cause) {
          return error(503, cause instanceof Error ? `Read-only DGX logs are unavailable. ${cause.message}` : 'Read-only DGX logs are unavailable.');
        }
      }
      default: return error(404, 'Not found');
    }
  }

  return Object.freeze({ dispatch });
}

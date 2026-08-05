const READ_PATHS = new Set([
  '/api/health',
  '/api/connection-status',
  '/api/remote-desktop/status',
  '/api/hardware/summary',
  '/api/hardware/gpu',
  '/api/hardware/storage',
  '/api/hardware/network',
  '/api/hardware/components',
  '/api/services',
  '/api/system',
  '/api/models/nvfp4/metrics',
  '/api/models/vlm/metrics',
  '/api/models/nvfp4/config',
  '/api/models/nvfp4/parameter-adapter',
  '/api/models/nvfp4/parameter-operations',
  '/api/requests',
  '/api/benchmarks',
  '/api/setup/capabilities',
  '/api/setup/profiles',
  '/api/local-control/capabilities',
  '/api/model-catalog',
  '/api/model-service-templates',
  '/api/model-service-adapters',
  '/api/model-service-configurations',
  '/api/nodes',
]);

function object(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value;
}

function exactBody(value, keys, message) {
  const body = object(value, message);
  if (Object.keys(body).some((key) => !keys.includes(key))) throw new Error(message);
  return body;
}

function exactRequiredBody(value, keys, message) {
  const body = exactBody(value, keys, message);
  if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key))) throw new Error(message);
  return body;
}

function validateSetupProfileBody(value) {
  const body = exactBody(value, ['displayName', 'sshAlias', 'hostKeyFingerprint'], 'Unsupported connection profile fields.');
  if (typeof body.displayName !== 'string' || /[\r\n]/.test(body.displayName) || !body.displayName.trim() || body.displayName.length > 64) {
    throw new Error('Invalid connection profile displayName.');
  }
  if (typeof body.sshAlias !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(body.sshAlias)) {
    throw new Error('Invalid connection profile sshAlias.');
  }
  if (Object.hasOwn(body, 'hostKeyFingerprint') && body.hostKeyFingerprint !== null && (typeof body.hostKeyFingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/=_-]{1,121}$/.test(body.hostKeyFingerprint))) {
    throw new Error('Invalid connection profile hostKeyFingerprint.');
  }
  return Object.freeze({ ...body, displayName: body.displayName.trim() });
}

function validateLocalControlPlanBody(value) {
  const body = exactRequiredBody(value, ['serviceId', 'action'], 'Unsupported local control plan fields.');
  if (!['nvfp4', 'vlm', 'image', 'proxy-8093'].includes(body.serviceId) || !['warmup', 'restart', 'stop'].includes(body.action)) {
    throw new Error('Unsupported local control plan.');
  }
  return Object.freeze({ serviceId: body.serviceId, action: body.action });
}

function validateNvfp4ParameterReviewBody(value) {
  const body = exactRequiredBody(value, ['proposed'], 'Unsupported parameter review fields.');
  const proposed = exactBody(body.proposed, ['maxModelLen', 'gpuMemoryUtilization', 'maxNumSeqs', 'maxNumBatchedTokens', 'kvCacheDtype', 'prefixCaching', 'mtpTokens'], 'Unsupported NVFP4 parameter fields.');
  if (Object.keys(proposed).length === 0) throw new Error('At least one NVFP4 parameter is required.');
  const numberFields = ['maxModelLen', 'gpuMemoryUtilization', 'maxNumSeqs', 'maxNumBatchedTokens', 'mtpTokens'];
  if (numberFields.some((key) => Object.hasOwn(proposed, key) && (typeof proposed[key] !== 'number' || !Number.isFinite(proposed[key])))) throw new Error('Invalid NVFP4 numeric parameter.');
  if (Object.hasOwn(proposed, 'kvCacheDtype') && proposed.kvCacheDtype !== 'fp8') throw new Error('Invalid NVFP4 KV cache parameter.');
  if (Object.hasOwn(proposed, 'prefixCaching') && typeof proposed.prefixCaching !== 'boolean') throw new Error('Invalid NVFP4 prefix cache parameter.');
  return Object.freeze({ proposed: Object.freeze({ ...proposed }) });
}

function validateEmptyBody(value, message) {
  const body = exactBody(value, [], message);
  if (Object.keys(body).length !== 0) throw new Error(message);
  return Object.freeze({});
}

function safePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || !value.startsWith('/api/')) {
    throw new Error('Unsupported desktop API path.');
  }
  const url = new URL(value, 'http://desktop.local');
  if (url.origin !== 'http://desktop.local' || url.hash || url.username || url.password) {
    throw new Error('Unsupported desktop API path.');
  }
  return { pathname: url.pathname, search: url.search, full: `${url.pathname}${url.search}` };
}

function safeLogs(path) {
  if (path.pathname !== '/api/logs') return false;
  const params = new URLSearchParams(path.search);
  const service = params.get('service');
  const lines = params.get('lines');
  return params.size === 2
    && typeof service === 'string'
    && /^[a-z0-9-]{1,32}$/.test(service)
    && typeof lines === 'string'
    && /^(?:[1-9]|[1-9][0-9]{1,2}|[1-4][0-9]{3}|500)$/.test(lines)
    && Number(lines) <= 500;
}

function safeOperation(path) {
  return /^\/api\/local-control\/operations\/[a-f0-9-]{36}$/.test(path.pathname) && path.search === '';
}

function safeVerify(path) {
  return /^\/api\/setup\/profiles\/[a-f0-9-]{36}\/verify$/.test(path.pathname) && path.search === '';
}

function safeActivate(path) {
  return /^\/api\/setup\/profiles\/[a-f0-9-]{36}\/activate$/.test(path.pathname) && path.search === '';
}

function safeConfirm(path) {
  return /^\/api\/local-control\/plans\/[a-f0-9-]{36}\/confirm$/.test(path.pathname) && path.search === '';
}

function safeModelServicePrecheck(path) { return /^\/api\/model-service-configurations\/[a-f0-9-]{36}\/precheck$/.test(path.pathname) && path.search === ''; }
function safeModelServicePlan(path) { return /^\/api\/model-service-configurations\/[a-f0-9-]{36}\/registration-plans$/.test(path.pathname) && path.search === ''; }
function safeModelServiceConfirm(path) { return /^\/api\/model-service-registration-plans\/[a-f0-9-]{36}\/confirm$/.test(path.pathname) && path.search === ''; }
function safeManagedServicePlan(path) { return /^\/api\/managed-services\/[a-f0-9-]{36}\/plans$/.test(path.pathname) && path.search === ''; }
function safeManagedServiceConfirm(path) { return /^\/api\/managed-service-plans\/[a-f0-9-]{36}\/confirm$/.test(path.pathname) && path.search === ''; }
function safeNvfp4ParameterReview(path) { return path.pathname === '/api/models/nvfp4/parameter-review' && path.search === ''; }
function safeNvfp4ParameterAdapterPlan(path) { return path.pathname === '/api/models/nvfp4/parameter-adapter/deployment-plans' && path.search === ''; }
function safeNvfp4ParameterAdapterConfirm(path) { return /^\/api\/models\/nvfp4\/parameter-adapter\/deployment-plans\/[a-f0-9-]{36}\/confirm$/.test(path.pathname) && path.search === ''; }
function safeNvfp4ParameterPlan(path) { return path.pathname === '/api/models/nvfp4/parameter-plans' && path.search === ''; }
function safeNvfp4ParameterPlanConfirm(path) { return /^\/api\/models\/nvfp4\/parameter-plans\/[a-f0-9-]{36}\/confirm$/.test(path.pathname) && path.search === ''; }
function safeNvfp4RollbackPlan(path) { return /^\/api\/models\/nvfp4\/parameter-operations\/[a-f0-9-]{36}\/rollback-plans$/.test(path.pathname) && path.search === ''; }
function safeNvfp4RollbackConfirm(path) { return /^\/api\/models\/nvfp4\/parameter-rollback-plans\/[a-f0-9-]{36}\/confirm$/.test(path.pathname) && path.search === ''; }
function safeModelCatalogSearch(path) {
  const params = new URLSearchParams(path.search);
  const query = params.get('q');
  return path.pathname === '/api/model-catalog/search'
    && params.size <= 1
    && (query === null || (typeof query === 'string' && query.length <= 80));
}
function safeHardwareHistory(path) {
  const params = new URLSearchParams(path.search);
  return path.pathname === '/api/hardware/history'
    && params.size === 2
    && ['gpuUtilizationPercent', 'cpuPercent', 'memoryUsedPercent', 'rootUsedPercent'].includes(params.get('metric'))
    && ['15m', '1h', '6h', '24h', '7d'].includes(params.get('range'));
}

function safeNodeDetail(path) {
  return /^\/api\/nodes\/[a-z0-9][a-z0-9-]{0,63}$/.test(path.pathname) && path.search === '';
}

function isAllowedGet(path) {
  return path.search === '' && READ_PATHS.has(path.pathname) || safeLogs(path) || safeOperation(path) || safeModelCatalogSearch(path) || safeModelServicePrecheck(path) || safeHardwareHistory(path) || safeNodeDetail(path);
}

function isAllowedPost(path) {
  return path.search === '' && (path.pathname === '/api/setup/profiles' || path.pathname === '/api/local-control/plans' || path.pathname === '/api/model-catalog' || path.pathname === '/api/model-service-configurations')
    || safeVerify(path)
    || safeActivate(path)
    || safeConfirm(path)
    || safeModelServicePlan(path)
    || safeModelServiceConfirm(path)
    || safeManagedServicePlan(path)
    || safeManagedServiceConfirm(path)
    || safeNvfp4ParameterReview(path)
    || safeNvfp4ParameterAdapterPlan(path)
    || safeNvfp4ParameterAdapterConfirm(path)
    || safeNvfp4ParameterPlan(path)
    || safeNvfp4ParameterPlanConfirm(path)
    || safeNvfp4RollbackPlan(path)
    || safeNvfp4RollbackConfirm(path);
}

function validatePostBody(path, body) {
  if (path.pathname === '/api/setup/profiles') return validateSetupProfileBody(body);
  if (path.pathname === '/api/local-control/plans') return validateLocalControlPlanBody(body);
  if (safeNvfp4ParameterReview(path)) return validateNvfp4ParameterReviewBody(body);
  if (safeNvfp4ParameterPlan(path)) return validateNvfp4ParameterReviewBody(body);
  if (safeNvfp4ParameterAdapterPlan(path) || safeNvfp4ParameterAdapterConfirm(path)) return validateEmptyBody(body, 'Parameter adapter deployment body must be empty.');
  if (safeNvfp4ParameterPlanConfirm(path) || safeNvfp4RollbackPlan(path) || safeNvfp4RollbackConfirm(path)) return validateEmptyBody(body, 'Parameter confirmation body must be empty.');
  if (path.pathname === '/api/model-catalog') return exactRequiredBody(body, ['resultId'], 'Model catalog requires a verified discovery result.');
  if (path.pathname === '/api/model-service-configurations') return exactRequiredBody(body, ['catalogEntryId', 'templateId', 'displayName'], 'Unsupported model service configuration fields.');
  if (safeVerify(path)) return validateEmptyBody(body, 'Setup verification body must be empty.');
  if (safeActivate(path)) return validateEmptyBody(body, 'Setup activation body must be empty.');
  if (safeConfirm(path)) return validateEmptyBody(body, 'Local control confirmation body must be empty.');
  if (safeModelServicePlan(path)) return validateEmptyBody(body, 'Registration plan body must be empty.');
  if (safeModelServiceConfirm(path)) return validateEmptyBody(body, 'Registration confirmation body must be empty.');
  if (safeManagedServicePlan(path)) { const requestBody = exactRequiredBody(body, ['action'], 'Managed service action is invalid.'); if (!['warmup', 'restart', 'stop'].includes(requestBody.action)) throw new Error('Managed service action is invalid.'); return requestBody; }
  if (safeManagedServiceConfirm(path)) return validateEmptyBody(body, 'Managed service confirmation body must be empty.');
  throw new Error('Desktop API route is not allowlisted.');
}

export function validateDesktopApiRequest(value) {
  const request = object(value, 'Desktop API request must be an object.');
  if (Object.keys(request).some((key) => !['method', 'path', 'body'].includes(key))) {
    throw new Error('Unsupported desktop API request field.');
  }
  const method = request.method;
  if (method !== 'GET' && method !== 'POST') throw new Error('Unsupported desktop API method.');
  const path = safePath(request.path);
  if (method === 'GET' && Object.prototype.hasOwnProperty.call(request, 'body')) throw new Error('Desktop GET requests cannot include a body.');
  if (method === 'POST' && !Object.prototype.hasOwnProperty.call(request, 'body')) throw new Error('Desktop POST requests require a body.');
  if (!(method === 'GET' ? isAllowedGet(path) : isAllowedPost(path))) throw new Error('Desktop API route is not allowlisted.');
  return Object.freeze({ method, path: path.full, ...(method === 'POST' ? { body: validatePostBody(path, request.body) } : {}) });
}

export function createDesktopApiBridge({ baseUrl, apiToken, fetcher = globalThis.fetch } = {}) {
  if (typeof baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(baseUrl) || typeof apiToken !== 'string' || apiToken.length < 32 || typeof fetcher !== 'function') {
    throw new Error('Desktop API bridge requires a loopback backend and session token.');
  }
  return Object.freeze({
    async request(value) {
      const request = validateDesktopApiRequest(value);
      const response = await fetcher(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiToken}`,
          ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(request.method === 'POST' ? { body: JSON.stringify(request.body) } : {}),
      });
      const payload = await response.json().catch(() => ({ error: 'Desktop backend returned an invalid response.' }));
      return Object.freeze({ status: response.status, payload });
    },
  });
}

/**
 * Desktop default adapter. The renderer still has only a fixed typed IPC
 * contract; Electron main invokes the shared application core directly, so no
 * loopback listener, session token or HTTP serialization is needed.
 */
export function createDesktopDirectAdapter({ dispatch } = {}) {
  if (typeof dispatch !== 'function') {
    throw new Error('Desktop direct adapter requires an application dispatcher.');
  }
  return Object.freeze({
    async request(value) {
      const request = validateDesktopApiRequest(value);
      const response = await dispatch(request);
      if (!response || typeof response !== 'object' || !Number.isInteger(response.status) || !Object.hasOwn(response, 'payload')) {
        throw new Error('Desktop application core returned an invalid response.');
      }
      return Object.freeze({ status: response.status, payload: response.payload });
    },
  });
}

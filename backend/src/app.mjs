import { timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createApplicationCore } from './application-core.mjs';

function responseHeaders(corsOrigins, requestOrigin) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (requestOrigin && corsOrigins?.includes(requestOrigin)) {
    headers['access-control-allow-origin'] = requestOrigin;
    headers.vary = 'Origin';
  }
  return headers;
}

function sendJson(response, status, payload, corsOrigins, requestOrigin, extraHeaders = {}) {
  response.writeHead(status, { ...responseHeaders(corsOrigins, requestOrigin), ...extraHeaders });
  response.end(JSON.stringify(payload));
}

function isLocalMachineRequest(request) {
  const address = request.socket?.remoteAddress?.replace(/^::ffff:/, '');
  if (address === '127.0.0.1' || address === '::1') return true;
  const addresses = Object.values(networkInterfaces()).flat().map((item) => item?.address?.replace(/^::ffff:/, '')).filter(Boolean);
  return Boolean(address && addresses.includes(address));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4_096) throw new Error('Control request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error('Control request must be a JSON object.');
  }
}

function isAuthorized(request, apiToken) {
  if (!apiToken) return true;
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(apiToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function setupProfilePath(pathname) {
  return pathname === '/api/setup/profiles'
    || /^\/api\/setup\/profiles\/[a-z0-9][a-z0-9-]{0,63}\/(verify|activate)$/.test(pathname);
}

function localControlPath(pathname) {
  return pathname.startsWith('/api/local-control/') || pathname.startsWith('/api/managed-services/') || pathname.startsWith('/api/managed-service-plans/') || pathname.startsWith('/api/models/nvfp4/parameter-adapter/') || pathname.startsWith('/api/models/nvfp4/parameter-plans/') || pathname.startsWith('/api/models/nvfp4/parameter-rollback-plans/') || /^\/api\/models\/nvfp4\/parameter-operations\/[a-f0-9-]{36}\/rollback-plans$/.test(pathname) || pathname === '/api/models/nvfp4/parameter-adapter' || pathname === '/api/models/nvfp4/parameter-operations' || pathname === '/api/models/nvfp4/parameter-plans' || pathname === '/api/models/nvfp4/parameter-review' || pathname === '/api/model-catalog' || pathname === '/api/model-catalog/search' || pathname === '/api/model-service-templates' || pathname === '/api/model-service-adapters' || pathname === '/api/model-service-configurations' || /^\/api\/model-service-configurations\/[a-f0-9-]{36}\/(precheck|registration-plans)$/.test(pathname) || /^\/api\/model-service-registration-plans\/[a-f0-9-]{36}\/confirm$/.test(pathname);
}

function handlePreflight(request, response, corsOrigins, requestOrigin, pathname, apiToken, isLocalRequest) {
  if (!requestOrigin || !corsOrigins?.includes(requestOrigin)) {
    sendJson(response, 403, { error: 'CORS origin is not allowed.' }, corsOrigins, requestOrigin);
    return;
  }
  const requestedMethod = request.headers['access-control-request-method'];
  const allowProtectedSetupPost = Boolean(apiToken) && setupProfilePath(pathname) && requestedMethod === 'POST';
  const allowLocalPost = isLocalRequest(request) && requestedMethod === 'POST';
  const allowPost = allowLocalPost || allowProtectedSetupPost;
  response.writeHead(204, {
    ...responseHeaders(corsOrigins, requestOrigin),
    'access-control-allow-methods': allowPost ? 'GET, OPTIONS, POST' : 'GET, OPTIONS',
    'access-control-allow-headers': allowPost ? 'Accept, Authorization, Content-Type' : 'Accept, Authorization',
    'access-control-max-age': '600',
  });
  response.end();
}

function acceptsJsonBody(pathname) {
  return pathname === '/api/setup/profiles'
    || /^\/api\/setup\/profiles\/[a-z0-9][a-z0-9-]{0,63}\/verify$/.test(pathname)
    || /^\/api\/setup\/profiles\/[a-z0-9][a-z0-9-]{0,63}\/activate$/.test(pathname)
    || pathname === '/api/local-control/plans'
    || pathname === '/api/local-control/recovery-required'
    || pathname === '/api/models/nvfp4/parameter-review'
    || pathname === '/api/models/nvfp4/parameter-plans'
    || pathname === '/api/models/nvfp4/parameter-adapter/deployment-plans'
    || /^\/api\/models\/nvfp4\/parameter-adapter\/deployment-plans\/[a-f0-9-]{36}\/confirm$/.test(pathname)
    || /^\/api\/models\/nvfp4\/parameter-plans\/[a-f0-9-]{36}\/confirm$/.test(pathname)
    || /^\/api\/models\/nvfp4\/parameter-operations\/[a-f0-9-]{36}\/rollback-plans$/.test(pathname)
    || /^\/api\/models\/nvfp4\/parameter-rollback-plans\/[a-f0-9-]{36}\/confirm$/.test(pathname)
    || pathname === '/api/model-catalog'
    || pathname === '/api/model-service-configurations'
    || /^\/api\/model-service-configurations\/[a-f0-9-]{36}\/registration-plans$/.test(pathname)
    || /^\/api\/model-service-registration-plans\/[a-f0-9-]{36}\/confirm$/.test(pathname)
    || /^\/api\/managed-services\/[a-f0-9-]{36}\/plans$/.test(pathname)
    || /^\/api\/managed-service-plans\/[a-f0-9-]{36}\/confirm$/.test(pathname)
    || /^\/api\/local-control\/plans\/[a-f0-9-]{36}\/confirm$/.test(pathname)
    || /^\/api\/local-control\/operations\/[a-f0-9-]{36}\/resolve-recovery$/.test(pathname);
}

/**
 * HTTP adapter for the transport-independent application core.
 * It intentionally owns HTTP-only concerns: bearer auth, CORS, request-size
 * limits and the LAN/local-only boundary. Business routes live in application-core.
 */
export function createApiHandler({ core = null, corsOrigins = [], apiToken = '', isLocalRequest = isLocalMachineRequest, ...coreOptions } = {}) {
  const application = core ?? createApplicationCore(coreOptions);
  return async (request, response) => {
    const requestOrigin = request.headers.origin;
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'OPTIONS') return handlePreflight(request, response, corsOrigins, requestOrigin, url.pathname, apiToken, isLocalRequest);
    if (!isAuthorized(request, apiToken)) {
      response.writeHead(401, {
        ...responseHeaders(corsOrigins, requestOrigin),
        'www-authenticate': 'Bearer realm="DGX AI Control Center"',
      });
      response.end(JSON.stringify({ error: 'API access token is required.' }));
      return;
    }

    if (localControlPath(url.pathname) && !isLocalRequest(request)) {
      sendJson(response, 403, { error: 'Local service control is available only from this computer.' }, corsOrigins, requestOrigin);
      return;
    }
    if (setupProfilePath(url.pathname) && !isLocalRequest(request) && !apiToken) {
      sendJson(response, 403, { error: 'Protected LAN connection setup requires an API access token.' }, corsOrigins, requestOrigin);
      return;
    }

    let body;
    if (request.method === 'POST' && acceptsJsonBody(url.pathname)) {
      try {
        body = await readJsonBody(request);
      } catch (cause) {
        sendJson(response, 400, { error: cause instanceof Error ? cause.message : 'Control request must be a JSON object.' }, corsOrigins, requestOrigin);
        return;
      }
    }

    try {
      const result = await application.dispatch({ method: request.method, path: `${url.pathname}${url.search}`, ...(body === undefined ? {} : { body }) });
      sendJson(response, result.status, result.payload, corsOrigins, requestOrigin, result.allow ? { allow: result.allow } : {});
    } catch {
      sendJson(response, 500, { error: 'Local application request failed.', code: 'APPLICATION_DISPATCH_FAILED', message: '本机应用请求未完成，请稍后重试。', requestId: Math.random().toString(36).slice(2, 14) }, corsOrigins, requestOrigin);
    }
  };
}

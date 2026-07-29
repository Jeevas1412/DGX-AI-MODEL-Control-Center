const DEFAULT_PORT = 8501;
const DEFAULT_SNAPSHOT_CACHE_MS = 2_500;
const DEFAULT_CORS_ORIGIN = 'http://127.0.0.1:8501';

function isLoopbackHost(host) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
}

function isPrivateIpv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

function readHost(value) {
  const host = value || '127.0.0.1';
  if (!isLoopbackHost(host) && !['0.0.0.0', '::'].includes(host)) {
    throw new Error('CONTROL_CENTER_HOST must be a loopback address or an explicit all-interface listener.');
  }
  return host;
}

function readPort(value) {
  if (value === undefined || value === '') {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('CONTROL_CENTER_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function readCacheDuration(value) {
  if (value === undefined || value === '') {
    return DEFAULT_SNAPSHOT_CACHE_MS;
  }
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 500 || duration > 30_000) {
    throw new Error('DGX_SNAPSHOT_CACHE_MS must be an integer between 500 and 30000.');
  }
  return duration;
}

function readSshTarget(value) {
  const target = value || '';
  if (!target) return '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(target)) {
    throw new Error('DGX_SSH_TARGET must be an SSH config alias or a simple host name.');
  }
  return target;
}

function readCorsOrigins(value, legacyValue) {
  const rawOrigins = (value || legacyValue || DEFAULT_CORS_ORIGIN).split(',').map((item) => item.trim()).filter(Boolean);
  if (rawOrigins.length === 0 || rawOrigins.length > 8) {
    throw new Error('CONTROL_CENTER_CORS_ORIGINS must contain between 1 and 8 HTTP origins.');
  }
  return rawOrigins.map((raw) => {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('CONTROL_CENTER_CORS_ORIGINS must contain valid private or loopback HTTP origins.');
    }
    if (parsed.protocol !== 'http:' || parsed.origin !== raw || (!isLoopbackHost(parsed.hostname) && !isPrivateIpv4(parsed.hostname))) {
      throw new Error('CONTROL_CENTER_CORS_ORIGINS must contain valid private or loopback HTTP origins.');
    }
    return parsed.origin;
  });
}

function readApiToken(value, host) {
  const token = value || '';
  if (token && !/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
    throw new Error('CONTROL_CENTER_API_TOKEN must be a 32-byte-or-stronger base64url token.');
  }
  if (!isLoopbackHost(host) && !token) {
    throw new Error('CONTROL_CENTER_API_TOKEN is required when CONTROL_CENTER_HOST is not loopback.');
  }
  return token;
}

export function readConfig(environment = process.env) {
  const host = readHost(environment.CONTROL_CENTER_HOST);
  return {
    host,
    port: readPort(environment.CONTROL_CENTER_PORT),
    dgxReadOnlyEnabled: environment.DGX_READ_ONLY_ENABLED === 'true',
    // An empty target is intentional: monitoring begins only after an
    // explicitly selected, verified connection profile binds a session.
    dgxSshTarget: readSshTarget(environment.DGX_SSH_TARGET),
    dgxSnapshotCacheMs: readCacheDuration(environment.DGX_SNAPSHOT_CACHE_MS),
    corsOrigins: readCorsOrigins(environment.CONTROL_CENTER_CORS_ORIGINS, environment.CONTROL_CENTER_CORS_ORIGIN),
    apiToken: readApiToken(environment.CONTROL_CENTER_API_TOKEN, host),
    localControlEnabled: environment.DGX_LOCAL_CONTROL_ENABLED === 'true',
  };
}

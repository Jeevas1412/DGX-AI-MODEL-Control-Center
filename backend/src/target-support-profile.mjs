const IDENTIFIER = /^[a-z][a-z0-9-]{2,63}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const HOME_PATH = /^\$HOME(?:\/[A-Za-z0-9._@+=,:%-]+)+$/;
const HTTP_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]{0,160}$/;

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function requiredText(value, label, pattern, maximum = 128) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || !pattern.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function nonEmptyDisplayName(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 96 || /[\r\n]/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value.trim();
}

function port(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${label}.`);
  return value;
}

function service(value) {
  const item = exactObject(value, ['id', 'displayName', 'health', 'logPath'], 'target support service');
  const health = exactObject(item.health, ['port', 'path'], 'target support service health check');
  return Object.freeze({
    id: requiredText(item.id, 'target support service id', IDENTIFIER, 64),
    displayName: nonEmptyDisplayName(item.displayName, 'target support service display name'),
    health: Object.freeze({
      port: port(health.port, 'target support service health port'),
      path: requiredText(health.path, 'target support service health path', HTTP_PATH, 161),
    }),
    logPath: item.logPath === null ? null : requiredText(item.logPath, 'target support service log path', HOME_PATH, 256),
  });
}

/**
 * Declarative target-local monitoring profile.
 *
 * The profile is never accepted from an API request and never carries a
 * command, shell fragment, URL, credential, or mutable endpoint. It is an
 * independently reviewed support asset loaded from the fixed target-local
 * directory after the target itself has been verified. `$HOME`-relative paths
 * avoid baking a current account name into the public application.
 */
export function validateTargetSupportProfile(value) {
  const profile = exactObject(value, ['schemaVersion', 'id', 'version', 'modelInventoryRoots', 'monitoring'], 'target support profile');
  if (profile.schemaVersion !== 1) throw new Error('Unsupported target support profile version.');
  if (!Array.isArray(profile.modelInventoryRoots) || profile.modelInventoryRoots.length === 0 || profile.modelInventoryRoots.length > 8) {
    throw new Error('Invalid target support model inventory roots.');
  }
  const roots = profile.modelInventoryRoots.map((root) => requiredText(root, 'target support model inventory root', HOME_PATH, 256));
  if (new Set(roots).size !== roots.length) throw new Error('Invalid target support model inventory roots.');
  const monitoring = exactObject(profile.monitoring, ['services'], 'target support monitoring');
  if (!Array.isArray(monitoring.services) || monitoring.services.length > 20) throw new Error('Invalid target support monitoring services.');
  const services = monitoring.services.map(service);
  if (new Set(services.map((item) => item.id)).size !== services.length) throw new Error('Invalid target support monitoring services.');
  return Object.freeze({
    schemaVersion: 1,
    id: requiredText(profile.id, 'target support profile id', IDENTIFIER, 64),
    version: requiredText(profile.version, 'target support profile version', VERSION, 32),
    modelInventoryRoots: Object.freeze(roots),
    monitoring: Object.freeze({ services: Object.freeze(services) }),
  });
}

export function publicTargetSupportProfile(profile, observedIntegritySha256) {
  const safe = validateTargetSupportProfile(profile);
  const integritySha256 = requiredText(observedIntegritySha256, 'observed target support profile integrity', SHA256, 71);
  return Object.freeze({
    id: safe.id,
    version: safe.version,
    integritySha256,
    modelInventoryRoots: safe.modelInventoryRoots.length,
    services: safe.monitoring.services.map((item) => Object.freeze({
      id: item.id,
      displayName: item.displayName,
      port: item.health.port,
      hasLogs: item.logPath !== null,
    })),
  });
}

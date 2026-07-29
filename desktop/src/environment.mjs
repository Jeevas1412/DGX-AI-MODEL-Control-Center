import { join } from 'node:path';

export const RUNTIME_CHANNELS = Object.freeze(['development', 'test', 'staging', 'production']);

export function resolveRuntimeChannel({ environment = process.env, packaged = false } = {}) {
  const candidate = environment.DGX_CONTROL_CENTER_CHANNEL || (packaged ? 'production' : 'development');
  if (!RUNTIME_CHANNELS.includes(candidate)) throw new Error('DGX_CONTROL_CENTER_CHANNEL must be development, test, staging, or production.');
  return candidate;
}

export function resolveUserDataDirectory({ appDataDirectory, channel, productName = 'DGX AI Control Center' }) {
  if (!RUNTIME_CHANNELS.includes(channel)) throw new Error('Unsupported runtime channel.');
  if (!appDataDirectory) throw new Error('appDataDirectory is required.');
  return join(appDataDirectory, `${productName}-${channel}`);
}

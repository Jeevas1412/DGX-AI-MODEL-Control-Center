import { createHash } from 'node:crypto';
import { executeRemoteScript } from './dgx-collector.mjs';
import { validateModelServiceAdapterManifest } from './model-service-adapter-contract.mjs';

const DISCOVERY_SCRIPT = String.raw`python3 - <<'PY'
import json
from hashlib import sha256
from pathlib import Path
root = Path.home() / '.dgx-ai-control-center' / 'adapters'
items = []
if root.is_dir():
  for candidate in sorted(root.glob('*/manifest.json'))[:20]:
    try:
      artifact = candidate.parent / 'run.sh'
      if not artifact.is_file():
        continue
      raw = candidate.read_bytes()
      items.append({'manifest': json.loads(raw.decode('utf-8')), 'observedIntegritySha256': 'sha256:' + sha256(artifact.read_bytes()).hexdigest()})
    except (OSError, UnicodeDecodeError, ValueError):
      continue
print(json.dumps({'items': items}))
PY`;

export function publicAdapter(adapter) {
  // The digest is not executable data or a secret. Returning it lets the
  // confirmation transaction bind an approved plan to exactly the adapter
  // that was re-verified on the target, without exposing paths or commands.
  return Object.freeze({ id: adapter.id, version: adapter.version, templateId: adapter.templateId, modelIds: adapter.modelIds, integritySha256: adapter.integritySha256, actions: adapter.actions, healthCheck: adapter.healthCheck, resourceBudget: adapter.resourceBudget, ...(adapter.parameters.length ? { parameters: adapter.parameters } : {}) });
}

export function createModelServiceAdapterDiscovery({ sshTarget, execute = executeRemoteScript } = {}) {
  if (typeof sshTarget !== 'string' || !sshTarget || typeof execute !== 'function') throw new Error('Model service adapter discovery is unavailable.');
  return async () => {
    const raw = await execute({ sshTarget, script: DISCOVERY_SCRIPT, timeoutMs: 15_000 });
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error('Model service adapter discovery returned invalid JSON.'); }
    if (!payload || !Array.isArray(payload.items) || payload.items.length > 20) throw new Error('Model service adapter discovery returned invalid data.');
    const items = [];
    for (const item of payload.items) {
      try {
        const adapter = validateModelServiceAdapterManifest(item?.manifest);
        if (adapter.integritySha256 !== item?.observedIntegritySha256) continue;
        items.push(publicAdapter(adapter));
      } catch { /* Ignore malformed or mismatched untrusted entries. */ }
    }
    return Object.freeze(items);
  };
}

export function adapterDiscoveryFingerprint(items) {
  return `sha256:${createHash('sha256').update(JSON.stringify(items), 'utf8').digest('hex')}`;
}

import { createHash } from 'node:crypto';
import { executeRemoteScript } from './dgx-collector.mjs';

// Fixed GET-only capability check. It receives no browser-controlled data and
// reports only the target identity and general monitoring availability.
const CAPABILITY_DISCOVERY_SCRIPT = String.raw`
python3 - <<'PY'
import json
from hashlib import sha256
from pathlib import Path
# A verified connection may be valid before monitoring is configured. The
# public capability probe therefore checks only for the presence of the fixed
# target-local declarative support profile; it does not assume any current
# service port, model name, account path, or health endpoint.
monitoring = (Path.home() / '.dgx-ai-control-center' / 'target-support-profile.json').is_file()
machine_id = None
for candidate in (Path('/etc/machine-id'), Path('/var/lib/dbus/machine-id')):
    try:
        value = candidate.read_text(encoding='utf-8').strip()
        if len(value) == 32 and all(character in '0123456789abcdefABCDEF' for character in value):
            machine_id = 'sha256:' + sha256(value.encode('utf-8')).hexdigest()
            break
    except OSError:
        pass
print(json.dumps({'monitoring': monitoring, 'machineIdentitySha256': machine_id}))
PY
`;

function mapped(probe, checkedAt) {
  if (!probe || typeof probe !== 'object' || typeof probe.monitoring !== 'boolean' || typeof probe.machineIdentitySha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(probe.machineIdentitySha256)) {
    throw new Error('Capability probe returned invalid JSON.');
  }
  const capabilities = Object.freeze({ monitoring: probe.monitoring ? 'available' : 'unavailable' });
  const capabilitySnapshotSha256 = `sha256:${createHash('sha256').update(JSON.stringify(capabilities), 'utf8').digest('hex')}`;
  return Object.freeze({
    schemaVersion: 1,
    checkedAt,
    connection: 'reachable',
    capabilities,
    verificationEvidence: Object.freeze({ targetMachineSha256: probe.machineIdentitySha256, capabilitySnapshotSha256 }),
  });
}

export function createCapabilityDiscovery({ sshTarget, execute = executeRemoteScript, now = () => new Date() }) {
  return async () => {
    const raw = await execute({ sshTarget, script: CAPABILITY_DISCOVERY_SCRIPT });
    let probe;
    try { probe = JSON.parse(raw); } catch { throw new Error('Capability probe returned invalid JSON.'); }
    return mapped(probe, now().toISOString());
  };
}

export function unavailableCapabilities(checkedAt = new Date().toISOString()) {
  return Object.freeze({ schemaVersion: 1, checkedAt, connection: 'not-configured', capabilities: Object.freeze({ monitoring: 'unknown' }) });
}

export function publicCapabilities(value) {
  const { verificationEvidence: _verificationEvidence, ...result } = value;
  return result;
}

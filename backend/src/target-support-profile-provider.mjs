import { createHash } from 'node:crypto';
import { executeRemoteScript } from './dgx-collector.mjs';
import { publicTargetSupportProfile, validateTargetSupportProfile } from './target-support-profile.mjs';

const SUPPORT_PROFILE_SCRIPT = String.raw`python3 - <<'PY'
import hashlib
import json
from pathlib import Path

path = Path.home() / '.dgx-ai-control-center' / 'target-support-profile.json'
if not path.is_file():
    print(json.dumps({'status': 'not-configured'}))
    raise SystemExit(0)
try:
    raw = path.read_bytes()
    if len(raw) > 65536:
        raise ValueError('profile too large')
    profile = json.loads(raw.decode('utf-8'))
except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError):
    print(json.dumps({'status': 'invalid'}))
    raise SystemExit(0)
print(json.dumps({'status': 'available', 'profile': profile, 'observedIntegritySha256': 'sha256:' + hashlib.sha256(raw).hexdigest()}))
PY`;

function validSshTarget(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

/** Reads one fixed target-local declarative profile. No browser-provided path,
 * package name, command, endpoint or credential is ever interpolated. */
export function createTargetSupportProfileProvider({ sshTarget, execute = executeRemoteScript } = {}) {
  if (!validSshTarget(sshTarget) || typeof execute !== 'function') throw new Error('Target support profile provider is unavailable.');
  return async () => {
    const raw = await execute({ sshTarget, script: SUPPORT_PROFILE_SCRIPT, timeoutMs: 15_000 });
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error('Target support profile returned invalid JSON.'); }
    if (!payload || typeof payload !== 'object' || !['not-configured', 'invalid', 'available'].includes(payload.status)) {
      throw new Error('Target support profile returned invalid data.');
    }
    if (payload.status === 'not-configured') return null;
    if (payload.status === 'invalid') throw new Error('Target support profile is invalid.');
    const safe = validateTargetSupportProfile(payload.profile);
    const publicProfile = publicTargetSupportProfile(safe, payload.observedIntegritySha256);
    return Object.freeze({ ...safe, observedIntegritySha256: publicProfile.integritySha256, public: publicProfile });
  };
}

export function targetSupportProfileFingerprint(profile) {
  if (profile === null) return null;
  const safe = validateTargetSupportProfile(profile);
  return `sha256:${createHash('sha256').update(JSON.stringify(safe), 'utf8').digest('hex')}`;
}

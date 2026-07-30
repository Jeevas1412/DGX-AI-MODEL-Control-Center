import { createHash, randomUUID } from 'node:crypto';

const MAX_QUERY_LENGTH = 80;
const RESULT_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_RESULTS = 50;

function queryText(value) {
  if (typeof value !== 'string' || value.length > MAX_QUERY_LENGTH || /[\r\n]/.test(value)) throw new Error('Model search query is invalid.');
  return value.trim().toLowerCase();
}

function localModelInventoryScript(roots) {
  if (!Array.isArray(roots) || roots.length === 0) throw new Error('Target support profile does not declare model inventory roots.');
  // Roots were already validated as `$HOME`-relative declarative values by
  // the target support profile provider. JSON string literals avoid shell
  // word-splitting while still allowing the remote shell to expand `$HOME`.
  const values = roots.map((root) => JSON.stringify(root)).join(' ');
  return `#!/usr/bin/env bash
set -euo pipefail
for root in ${values}; do
  [ -d "$root" ] || continue
  find "$root" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%p\\n' 2>/dev/null || true
done | head -n 200
`;
}

function modelKey(locator) {
  return `mdl-${createHash('sha256').update(locator, 'utf8').digest('hex').slice(0, 32)}`;
}

function publicDisplayName(locator) {
  const hf = locator.match(/^\.cache\/huggingface\/hub\/models--(.+)$/);
  return hf ? hf[1].split('--').join('/') : locator.split('/').at(-1);
}

function activeBinding(profile) {
  if (!profile || profile.verification?.status !== 'verified' || !/^sha256:[a-f0-9]{64}$/.test(profile.verification.evidence?.targetMachineSha256 ?? '') || !/^sha256:[a-f0-9]{64}$/.test(profile.verification.evidence?.capabilitySnapshotSha256 ?? '')) throw new Error('No verified active connection profile is selected.');
  return `${profile.id}:${profile.verification.evidence.targetMachineSha256}:${profile.verification.evidence.capabilitySnapshotSha256}`;
}

function targetMachineSha256(profile) {
  activeBinding(profile);
  return profile.verification.evidence.targetMachineSha256;
}

/** Fixed read-only discovery. The renderer sees only opaque one-time result
 * IDs and display names; relative DGX directories remain server-private. */
export function createModelSearchProvider({ executeRemote, sshTargetProvider, activeProfileProvider, targetSupportProfileProvider, now = () => new Date() } = {}) {
  if (typeof executeRemote !== 'function' || typeof sshTargetProvider !== 'function' || typeof activeProfileProvider !== 'function' || typeof targetSupportProfileProvider !== 'function') throw new Error('Verified DGX model search is unavailable.');
  const results = new Map();

  function prune() {
    const cutoff = now().getTime() - RESULT_TTL_MS;
    for (const [id, item] of results) if (item.discoveredAt < cutoff) results.delete(id);
  }

  async function search(query) {
    const needle = queryText(query);
    const profile = await activeProfileProvider();
    const binding = activeBinding(profile);
    const sshTarget = await sshTargetProvider();
    const supportProfile = await targetSupportProfileProvider();
    if (!supportProfile) throw new Error('Target support profile is not configured. Import and activate a reviewed target support package first.');
    const raw = await executeRemote({ sshTarget, script: localModelInventoryScript(supportProfile.modelInventoryRoots), timeoutMs: 20_000 });
    prune();
    // Discovery tokens are one-time capability-bound handles. Keep only the
    // newest result set so repeated refreshes cannot accumulate valid tokens.
    results.clear();
    const unique = new Set();
    const items = String(raw).split(/\r?\n/).map((path) => path.trim()).filter(Boolean)
      .map((path) => path.replace(/^\/home\/[^/]+\//, ''))
      .filter((locator) => locator.toLowerCase().includes(needle))
      .filter((locator) => !unique.has(locator) && unique.add(locator)).slice(0, MAX_ACTIVE_RESULTS)
      .map((locator) => {
        const resultId = randomUUID();
        const item = Object.freeze({ resultId, source: 'dgx-local', modelId: modelKey(locator), displayName: publicDisplayName(locator), locator, binding, targetMachineSha256: targetMachineSha256(profile), discoveredAt: now().getTime() });
        results.set(resultId, item);
        return Object.freeze({ resultId, source: item.source, modelId: item.modelId, displayName: item.displayName });
      });
    return Object.freeze(items);
  }

  async function consume(resultId) {
    if (typeof resultId !== 'string' || !/^[a-f0-9-]{36}$/.test(resultId)) throw new Error('Model discovery result is invalid.');
    prune();
    const item = results.get(resultId);
    if (!item) throw new Error('Model discovery result expired. Refresh the verified local model list.');
    const currentBinding = activeBinding(await activeProfileProvider());
    if (item.binding !== currentBinding) throw new Error('Model discovery result does not match the verified active connection. Refresh the model list.');
    results.delete(resultId);
    return Object.freeze({ source: item.source, modelId: item.modelId, displayName: item.displayName, targetMachineSha256: item.targetMachineSha256 });
  }

  return Object.freeze({ search, consume });
}

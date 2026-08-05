/**
 * NodeProbeService (0.2.0)
 *
 * A thin read-only aggregation layer over the existing single-target
 * snapshot providers. It keeps the 0.1.0 single-node operation model
 * untouched (activeProfileId stays a scalar) and adds a bounded, read-only
 * multi-node overview for the fixed Spark pair.
 *
 * Design notes (from the 2026-08-05 Copilot consultation, B-lite path):
 * - Promise.allSettled, never Promise.all: one node timing out must not
 *   fail the whole /api/nodes response. Partial success is a valid result.
 * - Node status is a strict four-state enum: healthy | degraded |
 *   unreachable | unknown.
 * - The overview never carries full logs; logs stay on the per-node route.
 * - Every node keeps its own error classification and collection timestamp.
 * - No write path goes through this service. It only reads.
 */
import { createDgxLogProvider, createDgxSnapshotProvider, createSnapshotCache } from './dgx-collector.mjs';

export const NODE_STATUS = Object.freeze({ HEALTHY: 'healthy', DEGRADED: 'degraded', UNREACHABLE: 'unreachable', UNKNOWN: 'unknown' });

export function nodeStatus({ snapshot, error }) {
  if (error) return NODE_STATUS.UNREACHABLE;
  if (!snapshot) return NODE_STATUS.UNKNOWN;
  return snapshot.health?.status === 'ok' ? NODE_STATUS.HEALTHY : NODE_STATUS.DEGRADED;
}

function errorKind(error) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) return 'timeout';
  if (/probe failed/i.test(message)) return 'probe-failed';
  if (/invalid json/i.test(message)) return 'invalid-response';
  return 'unknown';
}

/**
 * Builds one per-profile probe closure. `createSession` is the existing
 * profile-session factory so this service shares the exact same provider
 * wiring as the single-node UI.
 */
export function createNodeProbe({ profile, createSession, now = () => new Date() }) {
  let session = null;
  async function getSession() {
    if (!session) session = await createSession(profile);
    return session;
  }

  async function probe() {
    const startedAt = now().toISOString();
    try {
      const snapshot = await (await getSession()).snapshotProvider();
      return Object.freeze({
        profileId: profile.id,
        sshAlias: profile.sshAlias,
        displayName: profile.displayName,
        hostname: typeof snapshot.system?.hostname === 'string' ? snapshot.system.hostname : null,
        reachable: true,
        status: nodeStatus({ snapshot }),
        collectedAt: snapshot.generatedAt || startedAt,
        latencyMs: null,
        gpu: snapshot.system ? { gpuName: snapshot.system.gpuName, gpuDriverVersion: snapshot.system.gpuDriverVersion, gpuMemoryTotalMiB: snapshot.system.gpuMemoryTotalMiB, gpuMemoryUsedMiB: snapshot.system.gpuMemoryUsedMiB, gpuUtilizationPercent: snapshot.system.gpuUtilizationPercent, gpuPowerWatts: snapshot.system.gpuPowerWatts, gpuTemperatureCelsius: snapshot.system.gpuTemperatureCelsius } : null,
        system: snapshot.system || null,
        services: Array.isArray(snapshot.services) ? snapshot.services.map((item) => ({ id: item.id, name: item.name, status: item.status, port: item.port ?? null, residency: item.residency ?? null })) : [],
        interconnect: snapshot.interconnect || null,
        vllm: snapshot.vllm || null,
        errors: [],
      });
    } catch (cause) {
      return Object.freeze({
        profileId: profile.id,
        sshAlias: profile.sshAlias,
        displayName: profile.displayName,
        reachable: false,
        status: NODE_STATUS.UNREACHABLE,
        collectedAt: startedAt,
        latencyMs: null,
        gpu: null,
        system: null,
        services: [],
        interconnect: null,
        vllm: null,
        errors: Object.freeze([Object.freeze({ kind: errorKind(cause), message: cause instanceof Error ? cause.message : String(cause) })]),
      });
    }
  }

  async function logs(service, lines) {
    return (await getSession()).logProvider(service, lines);
  }

  return Object.freeze({ profile, probe, logs });
}

/**
 * Aggregates every verified profile in parallel with partial-success
 * semantics. The summary reflects the latest completed collection pass.
 */
export function createNodeSnapshotProvider({ profileStore, createSession, now = () => new Date() }) {
  return async function nodeSnapshotProvider({ profileId } = {}) {
    const document = await profileStore.load();
    let verified = document.profiles.filter((item) => item.verification?.status === 'verified');
    if (profileId) {
      const requested = verified.find((item) => item.id === profileId);
      verified = requested ? [requested] : [];
    }
    if (verified.length === 0) {
      return Object.freeze({ generatedAt: now().toISOString(), summary: { configured: 0, reachable: 0, healthy: 0, degraded: 0, unreachable: 0 }, nodes: [] });
    }
    const results = await Promise.allSettled(verified.map((profile) => createNodeProbe({ profile, createSession }).probe()));
    const nodes = results.map((result) => (result.status === 'fulfilled' ? result.value : Object.freeze({
      profileId: profileId ?? 'unknown',
      sshAlias: 'unknown',
      displayName: 'unknown',
      hostname: null,
      reachable: false,
      status: NODE_STATUS.UNKNOWN,
      collectedAt: now().toISOString(),
      latencyMs: null,
      gpu: null,
      system: null,
      services: [],
      errors: Object.freeze([Object.freeze({ kind: 'aggregation', message: result.reason instanceof Error ? result.reason.message : String(result.reason) })]),
    })));
    const summary = Object.freeze({
      configured: verified.length,
      reachable: nodes.filter((item) => item.reachable).length,
      healthy: nodes.filter((item) => item.status === NODE_STATUS.HEALTHY).length,
      degraded: nodes.filter((item) => item.status === NODE_STATUS.DEGRADED).length,
      unreachable: nodes.filter((item) => item.status === NODE_STATUS.UNREACHABLE).length,
    });
    return Object.freeze({ generatedAt: now().toISOString(), summary, nodes: Object.freeze(nodes) });
  };
}

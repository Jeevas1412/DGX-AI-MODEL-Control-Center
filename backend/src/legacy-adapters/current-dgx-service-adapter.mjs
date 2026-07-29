import { digestOperationSnapshot } from '../verified-operation-context.mjs';

const SERVICE_SPECS = Object.freeze({
  nvfp4: Object.freeze({ id: 'nvfp4', displayName: 'NVFP4', proxyPort: 8091, backendPort: 8092, start: 'bash "$HOME/ai/serve/start_nvfp4_lazy_proxy.sh"', warmupPath: '/warmup', healthPath: '/healthz', stopCommand: 'docker rm -f nvfp4-vllm-mtp-lazy >/dev/null 2>&1 || true' }),
  vlm: Object.freeze({ id: 'vlm', displayName: 'VLM', proxyPort: 8003, backendPort: 8005, start: 'bash "$HOME/ai/serve/serve_vlm.sh"', warmupPath: '/warmup', healthPath: '/healthz' }),
  image: Object.freeze({ id: 'image', displayName: 'Image service', proxyPort: 8188, backendPort: 8189, start: 'bash "$HOME/ai/serve/serve_img.sh"', warmupPath: '/warmup', healthPath: '/healthz' }),
  'proxy-8093': Object.freeze({ id: 'proxy-8093', displayName: 'API compatibility proxy', proxyPort: 8093, backendPort: null, start: '"$HOME/ai/serve/nvfp4_http_compat_proxy.py"', warmupPath: null, healthPath: '/healthz' }),
});

const ACTIONS = new Set(['warmup', 'restart', 'stop']);
const DEPLOYMENT_TOPOLOGY = 'dgx-spark-current-services-v1';
const COMPATIBILITY_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
for script in "$HOME/ai/serve/start_nvfp4_lazy_proxy.sh" "$HOME/ai/serve/serve_vlm.sh" "$HOME/ai/serve/serve_img.sh" "$HOME/ai/serve/nvfp4_http_compat_proxy.py"; do
  [ -f "$script" ] || { echo "missing registered adapter asset" >&2; exit 21; }
done
echo '{"compatible":true,"topology":"dgx-spark-current-services-v1"}'
`;

export const LEGACY_CURRENT_DGX_SERVICE_ADAPTER_MANIFEST = Object.freeze({
  id: 'legacy-current-dgx-services', version: '1.1.0', scope: 'known-current-machine-only', topology: DEPLOYMENT_TOPOLOGY, integrity: digestOperationSnapshot({ id: 'legacy-current-dgx-services', version: '1.1.0', topology: DEPLOYMENT_TOPOLOGY, services: SERVICE_SPECS, actions: [...ACTIONS], compatibilityScript: COMPATIBILITY_SCRIPT }),
  services: Object.freeze(Object.keys(SERVICE_SPECS)), actions: Object.freeze([...ACTIONS]),
});

function text(value, field, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`Invalid ${field}.`);
  return value;
}

function activeNvfp4Requests(snapshot) {
  const metrics = snapshot?.metrics?.nvfp4 ?? {};
  const running = Number.isFinite(metrics.runningRequests) ? metrics.runningRequests : 0;
  const queued = Number.isFinite(metrics.queuedRequests) ? metrics.queuedRequests : 0;
  return Math.max(0, running) + Math.max(0, queued);
}

function buildRemoteControlScript(service, action) {
  const backendStop = service.backendPort ? `stop_listener ${service.backendPort}\n${service.stopCommand ?? ''}` : '';
  const start = `start_service ${JSON.stringify(service.start)}\nwait_http ${service.proxyPort} ${JSON.stringify(service.healthPath)} 30`;
  const idleCheck = action === 'warmup' ? '' : `assert_no_connections ${service.proxyPort}\n${service.backendPort ? `assert_no_connections ${service.backendPort}` : ''}`;
  const warmup = service.warmupPath ? `curl -fsS --max-time 1800 http://127.0.0.1:${service.proxyPort}${service.warmupPath} >/dev/null` : `curl -fsS --max-time 8 http://127.0.0.1:${service.proxyPort}${service.healthPath} >/dev/null`;
  const actionScript = action === 'warmup' ? `if ! port_listening ${service.proxyPort}; then\n  ${start}\nfi\n${warmup}` : action === 'restart' ? `${idleCheck}\nstop_listener ${service.proxyPort}\n${backendStop}\n${start}` : `${idleCheck}\nstop_listener ${service.proxyPort}\n${backendStop}\nif port_listening ${service.proxyPort}; then echo 'proxy still listening' >&2; exit 1; fi`;
  return `#!/usr/bin/env bash
set -euo pipefail
port_listening() { ss -ltn "sport = :$1" 2>/dev/null | tail -n +2 | grep -q .; }
listener_pids() { ss -ltnp "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true; }
assert_no_connections() { local count; count=$(ss -tn state established "sport = :$1" 2>/dev/null | tail -n +2 | grep -c . || true); [ "$count" -eq 0 ] || exit 12; }
stop_listener() { local pids; pids=$(listener_pids "$1"); [ -z "$pids" ] && return 0; kill -TERM $pids; for _ in $(seq 1 30); do port_listening "$1" || return 0; sleep 1; done; exit 13; }
start_service() { setsid bash -lc "$1" </dev/null >/dev/null 2>&1 & }
wait_http() { local port="$1" path="$2" seconds="$3"; for _ in $(seq 1 "$seconds"); do curl -fsS --max-time 4 "http://127.0.0.1:$port$path" >/dev/null && return 0; sleep 1; done; exit 14; }
${actionScript}
echo '{"ok":true}'
`;
}

export function createLegacyCurrentDgxServiceAdapter() {
  function getService(serviceId) {
    const safeId = text(serviceId, 'serviceId', /^[a-z0-9-]{1,32}$/);
    const service = SERVICE_SPECS[safeId];
    if (!service) throw new Error('Unsupported legacy adapter service.');
    return service;
  }
  function validateAction(action) {
    const safeAction = text(action, 'action', /^(warmup|restart|stop)$/);
    if (!ACTIONS.has(safeAction)) throw new Error('Unsupported legacy adapter action.');
    return safeAction;
  }
  return Object.freeze({
    manifest: LEGACY_CURRENT_DGX_SERVICE_ADAPTER_MANIFEST,
    getService,
    validateAction,
    async assertCompatibility({ executeRemote, sshTarget }) {
      if (typeof executeRemote !== 'function' || typeof sshTarget !== 'string' || !sshTarget.trim()) throw new Error('Registered adapter compatibility verification is unavailable.');
      const output = await executeRemote({ sshTarget, script: COMPATIBILITY_SCRIPT, timeoutMs: 20_000 });
      if (!String(output).includes(`"topology":"${DEPLOYMENT_TOPOLOGY}"`)) throw new Error('Registered adapter deployment topology is incompatible.');
    },
    async assertPreconditions({ snapshot, service, action }) {
      if (action !== 'warmup' && service.id === 'nvfp4') {
        const activeRequests = activeNvfp4Requests(snapshot);
        if (activeRequests > 0) throw new Error(`NVFP4 has ${activeRequests} active or queued request(s); control is blocked.`);
      }
    },
    describePlan(service, action) { return `${action} is a legacy current-machine action for ${service.displayName}; non-warmup actions require the adapter idle policy.`; },
    buildRemoteAction({ service, action }) { return Object.freeze({ script: buildRemoteControlScript(service, action), timeoutMs: action === 'warmup' ? 1_850_000 : 90_000 }); },
    async verifyPostcondition({ snapshot, service, action }) {
      const current = snapshot?.services?.find((item) => item?.id === service.id);
      if (!current || typeof current.status !== 'string') throw new Error('Registered service postcondition is unavailable.');
      const expected = action === 'stop' ? 'offline' : 'running';
      if (current.status !== expected) throw new Error(`Registered service postcondition failed: expected ${expected}.`);
    },
  });
}

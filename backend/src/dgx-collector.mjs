import { spawn } from 'node:child_process';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

const LOG_FILES = Object.freeze({
  nvfp4: '/home/jin_jeevas/ai/logs/nvfp4_lazy_proxy.log',
  '8091': '/home/jin_jeevas/ai/logs/nvfp4_lazy_proxy.log',
  '8092': '/home/jin_jeevas/ai/logs/nvfp4_lazy_proxy.log',
  '8093': '/home/jin_jeevas/ai/logs/nvfp4_http_compat_proxy.log',
  vlm: '/home/jin_jeevas/ai/logs/vlm.log',
  image: '/home/jin_jeevas/ai/logs/img.log',
});

// This script is sent over standard input to `ssh <validated-target> bash -s`.
// It contains only fixed GET probes and fixed local diagnostic commands; it never
// receives a command, path, or URL from an HTTP request.
const SNAPSHOT_SCRIPT = String.raw`
python3 - <<'PY'
import json
import hashlib
import re
import subprocess
from datetime import datetime, timezone
from urllib.error import URLError, HTTPError
from urllib.request import ProxyHandler, Request, build_opener

opener = build_opener(ProxyHandler({}))

def request_text(url):
    try:
        with opener.open(Request(url, method='GET'), timeout=5) as response:
            return response.status, response.read().decode('utf-8', 'replace')
    except (URLError, HTTPError, TimeoutError, OSError):
        return None, None

def request_json(url):
    status, body = request_text(url)
    if status != 200 or not body:
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None

def command(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=3, check=False).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ''

def number(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return None

def metric(text, name):
    if not text:
        return None
    match = re.search(r'^' + re.escape(name) + r'(?:\{[^}]*\})?\s+([0-9.eE+-]+)\s*$', text, re.MULTILINE)
    return number(match.group(1)) if match else None

def ratio(numerator, denominator, scale=1):
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator * scale

def parse_memory():
    for line in command(['free', '-b']).splitlines():
        columns = line.split()
        # The free command localizes the row label on this DGX, so identify
        # the memory row by its numeric column layout instead of its label.
        if len(columns) >= 7 and number(columns[1]) is not None and number(columns[6]) is not None:
            return {'totalBytes': number(columns[1]), 'availableBytes': number(columns[6])}
    return {'totalBytes': None, 'availableBytes': None}

def parse_gpu():
    output = command([
        'nvidia-smi',
        '--query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw',
        '--format=csv,noheader,nounits',
    ]).strip()
    values = [value.strip() for value in output.split(',')] if output else []
    return {
        'name': values[0] if len(values) > 0 else None,
        'driverVersion': values[1] if len(values) > 1 else None,
        'memoryTotalMiB': number(values[2]) if len(values) > 2 else None,
        'memoryUsedMiB': number(values[3]) if len(values) > 3 else None,
        'utilizationPercent': number(values[4]) if len(values) > 4 else None,
        'temperatureCelsius': number(values[5]) if len(values) > 5 else None,
        'powerWatts': number(values[6]) if len(values) > 6 else None,
    }

def parse_compute_apps():
    output = command(['nvidia-smi', '--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits'])
    items = []
    for line in output.splitlines():
        values = [value.strip() for value in line.split(',', 2)]
        if len(values) != 3:
            continue
        try:
            items.append({'pid': int(values[0]), 'processName': values[1], 'usedMiB': float(values[2])})
        except ValueError:
            continue
    return items

def parse_nvfp4_config():
    try:
        with open('/home/jin_jeevas/ai/serve/serve_nvfp4_vllm_lazy_backend.sh', 'r', encoding='utf-8') as handle:
            text = handle.read()
    except OSError:
        return {}
    def capture(pattern, cast=str):
        found = re.search(pattern, text)
        if not found:
            return None
        try:
            return cast(found.group(1))
        except ValueError:
            return None
    return {
        'integritySha256': 'sha256:' + hashlib.sha256(text.encode('utf-8')).hexdigest(),
        'maxModelLen': capture(r'--max-model-len\s+(\d+)', int),
        'gpuMemoryUtilization': capture(r'--gpu-memory-utilization\s+([0-9.]+)', float),
        'maxNumSeqs': capture(r'--max-num-seqs\s+(\d+)', int),
        'maxNumBatchedTokens': capture(r'--max-num-batched-tokens\s+(\d+)', int),
        'kvCacheDtype': capture(r'--kv-cache-dtype\s+([A-Za-z0-9_-]+)'),
        'prefixCaching': '--enable-prefix-caching' in text,
        'mtpTokens': capture(r'--speculative-config.num_speculative_tokens\s+(\d+)', int),
    }

def parse_vlm_config():
    try:
        with open('/home/jin_jeevas/ai/serve/serve_vlm_backend.sh', 'r', encoding='utf-8') as handle:
            text = handle.read()
    except OSError:
        return {}
    found = re.search(r'MEM_FRACTION\s*=\s*([0-9.]+)', text)
    try:
        return {'memFractionStatic': float(found.group(1)) if found else None}
    except ValueError:
        return {}

nvfp4_proxy = request_json('http://127.0.0.1:8091/stats') or {}
vlm_proxy = request_json('http://127.0.0.1:8003/stats') or {}
image_system = request_json('http://127.0.0.1:8188/system_stats') or {}
image_devices = image_system.get('devices', []) if isinstance(image_system, dict) else []
image_device = image_devices[0] if image_devices and isinstance(image_devices[0], dict) else {}
compat_status, _ = request_text('http://127.0.0.1:8093/healthz')
_, metrics = request_text('http://127.0.0.1:8092/metrics')

ttft_sum = metric(metrics, 'vllm:time_to_first_token_seconds_sum')
ttft_count = metric(metrics, 'vllm:time_to_first_token_seconds_count')
itl_sum = metric(metrics, 'vllm:inter_token_latency_seconds_sum')
itl_count = metric(metrics, 'vllm:inter_token_latency_seconds_count')
prefix_hits = metric(metrics, 'vllm:prefix_cache_hits_total')
prefix_queries = metric(metrics, 'vllm:prefix_cache_queries_total')
accepted_tokens = metric(metrics, 'vllm:spec_decode_num_accepted_tokens_total')
draft_tokens = metric(metrics, 'vllm:spec_decode_num_draft_tokens_total')

print(json.dumps({
    'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
    'memory': parse_memory(),
    'gpu': {**parse_gpu(), 'computeApps': parse_compute_apps(), 'unifiedTotalBytes': image_device.get('vram_total'), 'unifiedFreeBytes': image_device.get('vram_free')},
    'nvfp4': {
        'backendRunning': bool(nvfp4_proxy.get('backend_running')),
        'backendPid': nvfp4_proxy.get('backend_pid'),
        'idleForSeconds': nvfp4_proxy.get('idle_for'),
        'idleThresholdSeconds': nvfp4_proxy.get('idle_threshold'),
        'idleUnloadEnabled': nvfp4_proxy.get('idle_unload_enabled'),
        'failedProbes': nvfp4_proxy.get('fail_count'),
        'ttftMs': ratio(ttft_sum, ttft_count, 1000),
        'tokensPerSecond': ratio(itl_count, itl_sum),
        'prefixCacheHitRate': ratio(prefix_hits, prefix_queries),
        'mtpAcceptanceRate': ratio(accepted_tokens, draft_tokens),
        'runningRequests': metric(metrics, 'vllm:num_requests_running'),
        'queuedRequests': metric(metrics, 'vllm:num_requests_waiting'),
        'kvCacheUsagePercent': ratio(metric(metrics, 'vllm:kv_cache_usage_perc'), 1, 100),
        'config': parse_nvfp4_config(),
    },
    'vlm': {
        'backendRunning': bool(vlm_proxy.get('backend_running')),
        'config': parse_vlm_config(),
        'backendPid': vlm_proxy.get('backend_pid'),
        'idleForSeconds': vlm_proxy.get('idle_for'),
        'idleThresholdSeconds': vlm_proxy.get('idle_threshold'),
        'failedProbes': vlm_proxy.get('fail_count'),
    },
    'image': {
        'available': bool(image_system),
        'ramTotalBytes': image_system.get('system', {}).get('ram_total'),
        'ramFreeBytes': image_system.get('system', {}).get('ram_free'),
    },
    'compatibilityProxyHealthy': compat_status == 200,
}))
PY
`;

function validSshTarget(target) {
  return typeof target === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(target);
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function serviceStatus(running) {
  return running ? 'running' : 'offline';
}

function memoryMiB(apps, predicate) {
  if (!Array.isArray(apps)) return null;
  const values = apps.filter(predicate).map((app) => asNumber(app?.usedMiB)).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function estimateMiB(fraction, totalBytes) {
  const total = asNumber(totalBytes);
  const totalMiB = total === null ? null : total / (1024 * 1024);
  return Number.isFinite(fraction) && totalMiB > 0 ? totalMiB * fraction : null;
}

function trimLogLine(line) {
  let safe = line
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/ig, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED]')
    .replace(/\b(api[ _-]?key|token|password|secret)\b\s*[:=]\s*[^\s,;]+/ig, '$1=[REDACTED]');
  if (safe.length > 4_000) {
    safe = `${safe.slice(0, 4_000)} …[truncated]`;
  }
  return safe;
}

function logLevel(line) {
  if (/\b(critical|fatal)\b/i.test(line)) return 'critical';
  if (/\b(error|exception|traceback|oom|out of memory)\b/i.test(line)) return 'error';
  if (/\b(warn|warning)\b/i.test(line)) return 'warning';
  return 'info';
}

function logItem(line) {
  const timestamp = line.match(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/)?.[0] ?? null;
  const message = trimLogLine(line);
  return { timestamp, level: logLevel(message), message };
}

function appendBoundedOutput(output, chunk, child) {
  const text = String(chunk);
  const remainingBytes = Math.max(0, MAX_OUTPUT_BYTES - Buffer.byteLength(output, 'utf8'));
  if (Buffer.byteLength(text, 'utf8') <= remainingBytes) return { output: output + text, truncated: false };

  // Keep only a bounded diagnostic prefix before stopping the child process.
  // This applies independently to stdout and stderr, because SSH can emit an
  // unbounded error stream even when the fixed probe itself returns no data.
  child.kill();
  return {
    output: output + Buffer.from(text, 'utf8').subarray(0, remainingBytes).toString('utf8'),
    truncated: true,
  };
}

export function executeRemoteScript({ sshTarget, script, timeoutMs = DEFAULT_TIMEOUT_MS, spawnProcess = spawn }) {
  if (!validSshTarget(sshTarget)) {
    return Promise.reject(new Error('DGX_SSH_TARGET must be an SSH config alias or a simple host name.'));
  }

  return new Promise((resolve, reject) => {
    const child = spawnProcess('ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=8',
      sshTarget,
      'bash -s',
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    const finish = (callback, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        callback(value);
      }
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(reject, new Error('DGX read-only probe timed out.'));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const result = appendBoundedOutput(stdout, chunk, child);
      stdout = result.output;
      stdoutTruncated ||= result.truncated;
    });
    child.stderr.on('data', (chunk) => {
      const result = appendBoundedOutput(stderr, chunk, child);
      stderr = result.output;
      stderrTruncated ||= result.truncated;
    });
    child.on('error', (error) => finish(reject, new Error(`Unable to start SSH: ${error.message}`)));
    child.on('close', (code) => {
      if (stdoutTruncated || stderrTruncated) {
        finish(reject, new Error('DGX read-only probe exceeded the output limit.'));
      } else if (code !== 0) {
        finish(reject, new Error(`DGX read-only probe failed${stderr ? `: ${stderr.trim()}` : ''}`));
      } else {
        finish(resolve, stdout);
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(script);
  });
}

export function snapshotFromProbe(probe) {
  const generatedAt = typeof probe.generatedAt === 'string' ? probe.generatedAt : new Date().toISOString();
  const nvfp4 = probe.nvfp4 || {};
  const vlm = probe.vlm || {};
  const image = probe.image || {};
  const gpu = probe.gpu || {};
  const memory = probe.memory || {};
  const computeApps = Array.isArray(gpu.computeApps) ? gpu.computeApps : [];
  const unifiedTotalBytes = asNumber(gpu.unifiedTotalBytes);
  const physicalTotalBytes = asNumber(memory.totalBytes);
  const physicalAvailableBytes = asNumber(memory.availableBytes);
  const nvfp4ObservedMiB = nvfp4.backendRunning ? memoryMiB(computeApps, (app) => app?.processName === 'VLLM::EngineCore') : null;
  const imageObservedMiB = image.available ? memoryMiB(computeApps, (app) => /python/i.test(app?.processName || '')) : null;
  const nvfp4EstimateMiB = nvfp4.backendRunning ? null : estimateMiB(asNumber(nvfp4.config?.gpuMemoryUtilization), unifiedTotalBytes);
  const vlmEstimateMiB = vlm.backendRunning ? null : estimateMiB(asNumber(vlm.config?.memFractionStatic), unifiedTotalBytes);
  // Linux MemAvailable is the capacity basis for all client-controlled model
  // actions. A ComfyUI process may report a smaller private pool, but that is
  // not a system-wide reservation and must not block an LLM by itself.
  const totalMiB = physicalTotalBytes === null ? null : physicalTotalBytes / (1024 * 1024);
  const freeMiB = physicalAvailableBytes === null ? null : physicalAvailableBytes / (1024 * 1024);
  const reserveMiB = totalMiB ? Math.max(8192, totalMiB * 0.1) : null;
  const allocatableMiB = freeMiB !== null && reserveMiB !== null ? Math.max(0, freeMiB - reserveMiB) : null;
  const coreHealthy = nvfp4.backendRunning && vlm.backendRunning && image.available && probe.compatibilityProxyHealthy;

  return {
    generatedAt,
    source: 'dgx-ssh-read-only',
    health: {
      status: coreHealthy ? 'ok' : 'degraded',
      generatedAt,
      detail: coreHealthy ? 'Read-only DGX probes succeeded.' : 'One or more read-only DGX probes are unavailable.',
    },
    services: [
      { id: 'nvfp4', name: 'NVFP4', status: serviceStatus(nvfp4.backendRunning), port: 8091, residency: nvfp4.backendRunning ? 'resident' : 'unloaded', uptimeSeconds: null, observedMemoryMiB: nvfp4ObservedMiB, estimatedMemoryMiB: nvfp4EstimateMiB, estimateSource: nvfp4EstimateMiB === null ? null : 'configured-reservation', idleForSeconds: asNumber(nvfp4.idleForSeconds), idleThresholdSeconds: asNumber(nvfp4.idleThresholdSeconds), failedProbes: asNumber(nvfp4.failedProbes) },
      { id: 'vlm', name: 'VLM', status: serviceStatus(vlm.backendRunning), port: 8003, residency: vlm.backendRunning ? 'resident' : 'unloaded', uptimeSeconds: null, observedMemoryMiB: null, estimatedMemoryMiB: vlmEstimateMiB, estimateSource: vlmEstimateMiB === null ? null : 'configured-reservation', idleForSeconds: asNumber(vlm.idleForSeconds), idleThresholdSeconds: asNumber(vlm.idleThresholdSeconds), failedProbes: asNumber(vlm.failedProbes) },
      { id: 'image', name: 'Image model', status: image.available ? 'running' : 'offline', port: 8188, residency: image.available ? 'resident' : 'unloaded', uptimeSeconds: null, observedMemoryMiB: imageObservedMiB, estimatedMemoryMiB: null, estimateSource: null },
      { id: 'proxy-8093', name: 'API compatibility proxy', status: probe.compatibilityProxyHealthy ? 'running' : 'offline', port: 8093, residency: 'resident', uptimeSeconds: null },
    ],
    system: {
      generatedAt,
      memoryTotalBytes: asNumber(memory.totalBytes),
      memoryAvailableBytes: asNumber(memory.availableBytes),
      gpuName: typeof gpu.name === 'string' ? gpu.name : null,
      gpuDriverVersion: typeof gpu.driverVersion === 'string' ? gpu.driverVersion : null,
      gpuMemoryTotalMiB: asNumber(gpu.memoryTotalMiB),
      gpuMemoryUsedMiB: asNumber(gpu.memoryUsedMiB),
      gpuUtilizationPercent: asNumber(gpu.utilizationPercent),
      gpuPowerWatts: asNumber(gpu.powerWatts),
      gpuTemperatureCelsius: asNumber(gpu.temperatureCelsius),
      modelMemoryBudget: { source: physicalTotalBytes ? 'linux-memavailable' : 'unavailable', totalMiB, freeMiB, safetyReserveMiB: reserveMiB, allocatableMiB },
      queueDepth: asNumber(nvfp4.queuedRequests),
    },
    metrics: {
      nvfp4: {
        generatedAt,
        ttftMs: asNumber(nvfp4.ttftMs),
        tokensPerSecond: asNumber(nvfp4.tokensPerSecond),
        prefixCacheHitRate: asNumber(nvfp4.prefixCacheHitRate),
        mtpAcceptanceRate: asNumber(nvfp4.mtpAcceptanceRate),
        runningRequests: asNumber(nvfp4.runningRequests),
        queuedRequests: asNumber(nvfp4.queuedRequests),
        kvCacheUsagePercent: asNumber(nvfp4.kvCacheUsagePercent),
        config: nvfp4.config || {},
      },
      vlm: {
        generatedAt,
        ttftMs: null,
        tokensPerSecond: null,
        prefixCacheHitRate: null,
        mtpAcceptanceRate: null,
        runningRequests: null,
        queuedRequests: null,
      },
    },
    requests: [],
    logs: [],
  };
}

export function createDgxSnapshotProvider({ sshTarget, execute = executeRemoteScript }) {
  return async () => {
    const output = await execute({ sshTarget, script: SNAPSHOT_SCRIPT });
    let probe;
    try {
      probe = JSON.parse(output);
    } catch {
      throw new Error('DGX read-only probe returned invalid JSON.');
    }
    return snapshotFromProbe(probe);
  };
}

export function createDgxLogProvider({ sshTarget, execute = executeRemoteScript }) {
  return async (service, lines) => {
    const logFile = LOG_FILES[service];
    if (!logFile) return [];
    const safeLines = Number.isInteger(lines) && lines >= 1 && lines <= 500 ? lines : 200;
    const output = await execute({ sshTarget, script: `tail -n ${safeLines} -- ${logFile} 2>/dev/null || true\n` });
    return output.split(/\r?\n/).filter(Boolean).map(logItem);
  };
}

export function createSnapshotCache(snapshotProvider, { ttlMs = 2_500, now = () => Date.now() } = {}) {
  let cached = null;
  let expiresAt = 0;
  let inFlight = null;

  return async () => {
    if (cached && now() < expiresAt) return cached;
    if (!inFlight) {
      inFlight = Promise.resolve(snapshotProvider())
        .then((snapshot) => {
          cached = snapshot;
          expiresAt = now() + ttlMs;
          return snapshot;
        })
        .finally(() => { inFlight = null; });
    }
    return inFlight;
  };
}

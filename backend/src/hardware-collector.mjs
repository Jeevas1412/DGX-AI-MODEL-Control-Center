import { executeRemoteScript } from './dgx-collector.mjs';

// Fixed hardware-only probe. It does not contact AI service ports, read model
// files, access Dashboard tokens, alter telemetry consent, or run any command
// supplied by a caller.  All parsing occurs against structured JSON.
const HARDWARE_PROBE_SCRIPT = String.raw`python3 - <<'PY'
import json
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

def command(args, timeout=3):
    try:
        return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=timeout).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ''

def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

def meminfo():
    items = {}
    try:
        for line in Path('/proc/meminfo').read_text(encoding='utf-8').splitlines():
            key, value = line.split(':', 1)
            fields = value.split()
            if fields and fields[0].isdigit(): items[key] = int(fields[0]) * 1024
    except (OSError, ValueError):
        pass
    total = items.get('MemTotal')
    available = items.get('MemAvailable')
    swap_total = items.get('SwapTotal')
    swap_free = items.get('SwapFree')
    return {'totalBytes': total, 'availableBytes': available, 'swapTotalBytes': swap_total, 'swapUsedBytes': None if swap_total is None or swap_free is None else max(0, swap_total-swap_free)}

def cpu():
    try:
        fields = Path('/proc/stat').read_text(encoding='utf-8').splitlines()[0].split()[1:]
        values = [int(item) for item in fields]
        total = sum(values)
        idle = values[3] + (values[4] if len(values) > 4 else 0)
        return {'totalTicks': total, 'idleTicks': idle}
    except (OSError, ValueError, IndexError):
        return {'totalTicks': None, 'idleTicks': None}

def load():
    try:
        values = Path('/proc/loadavg').read_text(encoding='utf-8').split()[:3]
        return {'load1': number(values[0]), 'load5': number(values[1]), 'load15': number(values[2])}
    except (OSError, IndexError):
        return {'load1': None, 'load5': None, 'load15': None}

def uptime():
    try: return number(Path('/proc/uptime').read_text(encoding='utf-8').split()[0])
    except (OSError, IndexError): return None

def storage():
    try:
        info = __import__('os').statvfs('/')
        total = info.f_frsize * info.f_blocks
        available = info.f_frsize * info.f_bavail
        used = max(0, total - info.f_frsize * info.f_bfree)
        return {'rootTotalBytes': total, 'rootUsedBytes': used, 'rootAvailableBytes': available}
    except OSError:
        return {'rootTotalBytes': None, 'rootUsedBytes': None, 'rootAvailableBytes': None}

def gpu():
    if not shutil.which('nvidia-smi'):
        return {'supported': False, 'utilizationPercent': None, 'temperatureC': None, 'powerWatts': None, 'memoryUsedBytes': None, 'memoryTotalBytes': None, 'unsupportedFields': ['utilizationPercent','temperatureC','powerWatts','memoryUsedBytes','memoryTotalBytes']}
    output = command(['nvidia-smi', '--query-gpu=memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw', '--format=csv,noheader,nounits'])
    values = [number(item.strip()) for item in output.split(',')] if output else []
    fields = {'memoryTotalBytes': values[0] * 1024 * 1024 if len(values) > 0 and values[0] is not None else None, 'memoryUsedBytes': values[1] * 1024 * 1024 if len(values) > 1 and values[1] is not None else None, 'utilizationPercent': values[2] if len(values) > 2 else None, 'temperatureC': values[3] if len(values) > 3 else None, 'powerWatts': values[4] if len(values) > 4 else None}
    return {'supported': True, **fields, 'unsupportedFields': [key for key, value in fields.items() if value is None]}

def network():
    received = sent = 0
    try:
        for line in Path('/proc/net/dev').read_text(encoding='utf-8').splitlines()[2:]:
            name, values = line.split(':', 1)
            if name.strip() == 'lo': continue
            fields = values.split()
            if len(fields) >= 9:
                received += int(fields[0]); sent += int(fields[8])
        return {'receivedBytes': received, 'sentBytes': sent}
    except (OSError, ValueError): return {'receivedBytes': None, 'sentBytes': None}

def component(name):
    value = command(['systemctl', 'is-active', name])
    return 'active' if value == 'active' else 'inactive' if value in ('inactive','failed','deactivating') else 'unknown'

print(json.dumps({'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00','Z'), 'uptimeSeconds': uptime(), 'cpu': cpu(), 'load': load(), 'memory': meminfo(), 'gpu': gpu(), 'storage': storage(), 'network': network(), 'components': {name: component(name) for name in ['nvidia-persistenced.service','nvidia-dgx-dashboard.service','nvidia-dgx-telemetry.service','smartd.service','sysstat.service','gnome-remote-desktop.service']}} , separators=(',',':')))
PY`;

const COMPONENTS = Object.freeze({
  'nvidia-persistenced.service': 'nvidia-persistence',
  'nvidia-dgx-dashboard.service': 'nvidia-dashboard',
  'nvidia-dgx-telemetry.service': 'nvidia-telemetry',
  'smartd.service': 'smartd',
  'sysstat.service': 'sysstat',
  'gnome-remote-desktop.service': 'remote-desktop',
});
const componentStates = new Set(['active', 'inactive', 'unknown']);

function finite(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function requiredBoolean(value) { if (typeof value !== 'boolean') throw new Error('Hardware GPU support flag is invalid.'); return value; }
function text(value) { return typeof value === 'string' && value.length <= 64 ? value : null; }
function ratio(numerator, denominator) { return numerator === null || denominator === null || denominator <= 0 ? null : Math.max(0, Math.min(100, numerator / denominator * 100)); }

function componentList(items) {
  if (!items || typeof items !== 'object' || Array.isArray(items)) throw new Error('Hardware component data is invalid.');
  return Object.freeze(Object.entries(COMPONENTS).map(([service, id]) => {
    const state = items[service];
    if (!componentStates.has(state)) throw new Error('Hardware component state is invalid.');
    return Object.freeze({ id, state });
  }));
}

function cpuPercent(current, previous) {
  if (!previous || current.totalTicks === null || current.idleTicks === null) return null;
  const totalDelta = current.totalTicks - previous.totalTicks;
  const idleDelta = current.idleTicks - previous.idleTicks;
  return totalDelta > 0 && idleDelta >= 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : null;
}

export function hardwareProbeScript() { return HARDWARE_PROBE_SCRIPT; }

export function hardwareSummaryFromProbe(probe, { previousCpu = null, collectedAt = new Date().toISOString() } = {}) {
  if (!probe || typeof probe !== 'object' || Array.isArray(probe)) throw new Error('Hardware probe data is invalid.');
  const memory = probe.memory && typeof probe.memory === 'object' ? probe.memory : {};
  const storage = probe.storage && typeof probe.storage === 'object' ? probe.storage : {};
  const gpu = probe.gpu && typeof probe.gpu === 'object' ? probe.gpu : {};
  const network = probe.network && typeof probe.network === 'object' ? probe.network : {};
  const load = probe.load && typeof probe.load === 'object' ? probe.load : {};
  const cpu = probe.cpu && typeof probe.cpu === 'object' ? { totalTicks: finite(probe.cpu.totalTicks), idleTicks: finite(probe.cpu.idleTicks) } : { totalTicks: null, idleTicks: null };
  const totalBytes = finite(memory.totalBytes);
  const availableBytes = finite(memory.availableBytes);
  const rootTotalBytes = finite(storage.rootTotalBytes);
  const rootUsedBytes = finite(storage.rootUsedBytes);
  const gpuSupported = requiredBoolean(gpu.supported);
  const gpuFields = {
    utilizationPercent: finite(gpu.utilizationPercent), temperatureC: finite(gpu.temperatureC), powerWatts: finite(gpu.powerWatts), memoryUsedBytes: finite(gpu.memoryUsedBytes), memoryTotalBytes: finite(gpu.memoryTotalBytes),
  };
  if (!Array.isArray(gpu.unsupportedFields) || gpu.unsupportedFields.some((item) => typeof item !== 'string' || !Object.hasOwn(gpuFields, item))) throw new Error('Hardware GPU field status is invalid.');
  const generatedAt = text(probe.generatedAt) ?? collectedAt;
  return Object.freeze({
    status: 'healthy', connection: 'connected', collectedAt: generatedAt, ageMs: Math.max(0, Date.parse(collectedAt) - Date.parse(generatedAt) || 0), source: 'fixed-ssh-hardware-probe',
    system: Object.freeze({ uptimeSeconds: finite(probe.uptimeSeconds), load1: finite(load.load1), load5: finite(load.load5), load15: finite(load.load15), cpuPercent: cpuPercent(cpu, previousCpu) }),
    memory: Object.freeze({ totalBytes, availableBytes, usedBytes: totalBytes === null || availableBytes === null ? null : Math.max(0, totalBytes - availableBytes), usedPercent: ratio(totalBytes === null || availableBytes === null ? null : totalBytes - availableBytes, totalBytes), swapTotalBytes: finite(memory.swapTotalBytes), swapUsedBytes: finite(memory.swapUsedBytes) }),
    gpu: Object.freeze({ supported: gpuSupported, ...gpuFields, unsupportedFields: Object.freeze([...gpu.unsupportedFields]) }),
    storage: Object.freeze({ rootTotalBytes, rootUsedBytes, rootAvailableBytes: finite(storage.rootAvailableBytes), rootUsedPercent: ratio(rootUsedBytes, rootTotalBytes), smart: 'unknown' }),
    network: Object.freeze({ receivedBytes: finite(network.receivedBytes), sentBytes: finite(network.sentBytes) }),
    components: componentList(probe.components),
    freshness: Object.freeze({ state: 'fresh', cached: false }),
    _cpu: Object.freeze(cpu),
  });
}

export function publicHardwareSummary(value) {
  const { _cpu, ...publicValue } = value;
  return Object.freeze(publicValue);
}

export function createHardwareSnapshotProvider({ sshTarget, execute = executeRemoteScript, now = () => new Date() } = {}) {
  if (typeof sshTarget !== 'string' || !sshTarget || typeof execute !== 'function') throw new Error('Hardware snapshot provider is unavailable.');
  let previousCpu = null;
  return async () => {
    const collectedAt = now().toISOString();
    const raw = await execute({ sshTarget, script: HARDWARE_PROBE_SCRIPT, timeoutMs: 15_000 });
    let probe;
    try { probe = JSON.parse(raw); } catch { throw new Error('Hardware probe returned invalid JSON.'); }
    const summary = hardwareSummaryFromProbe(probe, { previousCpu, collectedAt });
    previousCpu = summary._cpu;
    return publicHardwareSummary(summary);
  };
}

export function createHardwareSnapshotCache(provider, { ttlMs = 3_000, now = () => Date.now() } = {}) {
  if (typeof provider !== 'function') throw new Error('Hardware snapshot cache requires a provider.');
  let cached = null;
  let expiresAt = 0;
  let inFlight = null;
  return async () => {
    if (cached && now() < expiresAt) return Object.freeze({ ...cached, ageMs: Math.max(0, now() - Date.parse(cached.collectedAt)), freshness: Object.freeze({ state: 'fresh', cached: true }) });
    if (!inFlight) inFlight = Promise.resolve(provider()).then((value) => { cached = value; expiresAt = now() + ttlMs; return value; }).finally(() => { inFlight = null; });
    return inFlight;
  };
}

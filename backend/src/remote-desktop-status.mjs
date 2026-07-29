import { executeRemoteScript } from './dgx-collector.mjs';

// This script is intentionally status-only. It never invokes sudo, grdctl
// mutation subcommands, firewall tools, account tools or a service start/stop
// action. Its output is a narrow JSON contract rather than raw system output.
const READ_ONLY_STATUS_SCRIPT = String.raw`python3 - <<'PY'
import json
import shutil
import subprocess

def run(args):
    try:
        return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ''

if not shutil.which('grdctl'):
    print(json.dumps({'supported': False, 'service': 'unknown', 'listener': 'unknown'}))
    raise SystemExit(0)

raw_service = run(['systemctl', 'is-active', 'gnome-remote-desktop.service'])
service = 'active' if raw_service == 'active' else 'inactive' if raw_service in ('inactive', 'failed', 'deactivating') else 'unknown'
raw_listener = run(['ss', '-H', '-ltn', 'sport = :3389'])
listener = 'listening' if raw_listener else 'not-listening'
print(json.dumps({'supported': True, 'service': service, 'listener': listener}))
PY`;

const states = new Set(['ready', 'requires-admin-bootstrap', 'externally-managed', 'unsupported', 'conflict', 'unreachable', 'not-configured']);
const serviceStates = new Set(['active', 'inactive', 'absent', 'unknown']);
const listenerStates = new Set(['listening', 'not-listening', 'unknown']);

function status(value) {
  if (typeof value !== 'string' || !states.has(value)) throw new Error('Remote desktop status is invalid.');
  return value;
}

function service(value) {
  if (typeof value !== 'string' || !serviceStates.has(value)) throw new Error('Remote desktop service state is invalid.');
  return value;
}

function listener(value) {
  if (typeof value !== 'string' || !listenerStates.has(value)) throw new Error('Remote desktop listener state is invalid.');
  return value;
}

export function readOnlyRemoteDesktopScript() {
  return READ_ONLY_STATUS_SCRIPT;
}

export function parseRemoteDesktopStatus(raw, { checkedAt = new Date().toISOString() } = {}) {
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error('Remote desktop status returned invalid JSON.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.supported !== 'boolean') {
    throw new Error('Remote desktop status returned invalid data.');
  }
  if (!payload.supported) {
    return Object.freeze({ state: 'unsupported', checkedAt, service: 'unknown', listener: 'unknown', nla: 'unknown', management: 'unknown', nextStep: '当前 DGX 未检测到受支持的 GNOME Remote Desktop 工具；不会尝试安装或替换服务。' });
  }
  const observedService = service(payload.service);
  const observedListener = listener(payload.listener);
  if (observedService === 'active' && observedListener === 'listening') {
    // Until the product deployment marker and credential vault exist, an
    // existing healthy service is external by definition and is never
    // overwritten by the control center.
    return Object.freeze({ state: 'externally-managed', checkedAt, service: observedService, listener: observedListener, nla: 'unknown', management: 'external', nextStep: '检测到已运行的 GNOME 远程桌面。当前按外部管理处理，不会改写账户、凭据、TLS 或服务配置。' });
  }
  return Object.freeze({ state: 'requires-admin-bootstrap', checkedAt, service: observedService, listener: observedListener, nla: 'unknown', management: 'not-configured', nextStep: '已检测到 GNOME 远程桌面工具，但尚未达到可连接状态。完成固定适配器、管理员授权和后置验证后才可部署。' });
}

export function createRemoteDesktopStatusProvider({ sshTargetProvider, execute = executeRemoteScript, now = () => new Date() } = {}) {
  if (typeof sshTargetProvider !== 'function' || typeof execute !== 'function') throw new Error('Remote desktop status provider is unavailable.');
  return async () => parseRemoteDesktopStatus(await execute({ sshTarget: await sshTargetProvider(), script: READ_ONLY_STATUS_SCRIPT, timeoutMs: 15_000 }), { checkedAt: now().toISOString() });
}

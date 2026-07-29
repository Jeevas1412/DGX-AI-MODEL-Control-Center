import { createHash, randomUUID } from 'node:crypto';
import { executeRemoteScript } from './dgx-collector.mjs';

const RUNTIME_ID = /^runtime-[a-f0-9]{32}$/;
const ACTIONS = new Set(['suspend', 'resume']);

const DISCOVERY_SCRIPT = String.raw`python3 - <<'PY'
import hashlib,json,os,subprocess
def run(args):
  try: return subprocess.run(args,capture_output=True,text=True,timeout=6,check=False).stdout
  except (OSError,subprocess.TimeoutExpired): return ''
def value_after(args,key):
  for i,value in enumerate(args):
    if value == key and i+1 < len(args): return args[i+1]
  return None
def gpu_memory(container_id):
  total=0; short=container_id[:12]
  for line in run(['nvidia-smi','--query-compute-apps=pid,used_memory','--format=csv,noheader,nounits']).splitlines():
    parts=[part.strip() for part in line.split(',',1)]
    if len(parts)!=2 or not parts[0].isdigit(): continue
    try:
      if short in open('/proc/'+parts[0]+'/cgroup',encoding='utf-8',errors='replace').read(): total += int(float(parts[1]))
    except (OSError,ValueError): pass
  return total
items=[]
for container_id in run(['docker','ps','-aq']).split()[:100]:
  try:
    data=json.loads(run(['docker','inspect',container_id]))[0]; config=data.get('Config') or {}; host=data.get('HostConfig') or {}; state=data.get('State') or {}
    args=config.get('Cmd') or []; model=value_after(args,'--model'); port=value_after(args,'--port'); image=str(config.get('Image') or ''); restart=(host.get('RestartPolicy') or {}).get('Name') or 'no'
    port=int(port)
    if not (model and model.lower().endswith('.gguf') and 1<=port<=65535 and restart=='no' and host.get('NetworkMode')=='host' and 'llama.cpp' in image): continue
    basis={'container':container_id,'image':image,'args':args,'network':host.get('NetworkMode'),'restart':restart,'port':port}; fingerprint=hashlib.sha256(json.dumps(basis,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    runtime_id='runtime-'+hashlib.sha256(('runtime:'+container_id+fingerprint).encode()).hexdigest()[:32]
    items.append({'id':runtime_id,'displayName':os.path.basename(model).rsplit('.',1)[0],'state':'running' if state.get('Running') else 'stopped','resourceMiB':gpu_memory(container_id),'recoverable':True,'_containerId':container_id,'_fingerprint':fingerprint,'_port':port})
  except (IndexError,KeyError,TypeError,ValueError): pass
print(json.dumps({'items':items},separators=(',',':')))
PY`;

function parse(raw) {
  let parsed; try { parsed = JSON.parse(raw); } catch { throw new Error('External runtime discovery returned invalid data.'); }
  if (!Array.isArray(parsed?.items)) throw new Error('External runtime discovery returned invalid data.');
  return parsed.items.filter((item) => item && RUNTIME_ID.test(item.id) && typeof item.displayName === 'string' && item.displayName.length > 0 && ['running','stopped'].includes(item.state) && Number.isFinite(item.resourceMiB) && item.resourceMiB >= 0 && item.recoverable === true && /^[a-f0-9]{12,64}$/.test(item._containerId) && /^[a-f0-9]{64}$/.test(item._fingerprint) && Number.isInteger(item._port) && item._port >= 1 && item._port <= 65535).map((item) => Object.freeze({ ...item, resourceMiB: Math.floor(item.resourceMiB) }));
}
function publicItem(item) { const { _containerId, _fingerprint, _port, ...safe } = item; return Object.freeze(safe); }
function actionScript(item, action) {
  const operation = action === 'suspend'
    ? `ss -tn state established "sport = :$port" 2>/dev/null | tail -n +2 | grep -q . && { echo 'active client connection blocks suspension' >&2; exit 12; }\ndocker stop --time 30 "$container" >/dev/null\ndocker inspect --format '{{.State.Running}}' "$container" | grep -qx false`
    : `docker start "$container" >/dev/null\nfor _ in $(seq 1 180); do curl -fsS --max-time 3 "http://127.0.0.1:$port/health" >/dev/null && exit 0; sleep 1; done\necho 'external runtime did not become healthy' >&2\nexit 14`;
  return `set -euo pipefail\ncontainer='${item._containerId}'\nexpected='${item._fingerprint}'\nport='${item._port}'\nactual="$(python3 - "$container" <<'PY'\nimport hashlib,json,subprocess,sys\ndata=json.loads(subprocess.check_output(['docker','inspect',sys.argv[1]],text=True))[0]; config=data.get('Config') or {}; host=data.get('HostConfig') or {}; args=config.get('Cmd') or []; port=None\nfor i,value in enumerate(args):\n  if value=='--port' and i+1<len(args): port=int(args[i+1]); break\nbasis={'container':sys.argv[1],'image':str(config.get('Image') or ''),'args':args,'network':host.get('NetworkMode'),'restart':(host.get('RestartPolicy') or {}).get('Name') or 'no','port':port}\nprint(hashlib.sha256(json.dumps(basis,sort_keys=True,separators=(',',':')).encode()).hexdigest())\nPY\n)"\n[ "$actual" = "$expected" ] || { echo 'external runtime identity changed' >&2; exit 78; }\n${operation}\necho '{"ok":true}'`;
}

export function createExternalRuntimeCoordinator({ sshTargetProvider, execute = executeRemoteScript } = {}) {
  if (typeof sshTargetProvider !== 'function' || typeof execute !== 'function') throw new Error('External runtime coordinator is unavailable.');
  const current = async () => parse(await execute({ sshTarget: await sshTargetProvider(), script: DISCOVERY_SCRIPT, timeoutMs: 20_000 }));
  return Object.freeze({
    async list() { return Object.freeze((await current()).map(publicItem)); },
    async plan({ runtimeId, action }) {
      if (!RUNTIME_ID.test(runtimeId) || !ACTIONS.has(action)) throw new Error('External runtime plan is invalid.');
      const item = (await current()).find((candidate) => candidate.id === runtimeId);
      if (!item || (action === 'suspend' && item.state !== 'running') || (action === 'resume' && item.state !== 'stopped')) throw new Error('External runtime state changed; refresh before creating a plan.');
      return Object.freeze({ id: randomUUID(), runtimeId: item.id, action, risk: 'high', resourceMiB: item.resourceMiB, displayName: item.displayName, summary: action === 'suspend' ? `将暂停“${item.displayName}”以释放其当前约 ${item.resourceMiB} MiB 的统一显存；不会启动其他模型。` : `将恢复“${item.displayName}”原有容器；不会修改其模型、参数或网络配置。`, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+300000).toISOString(), status: 'awaiting-confirmation', binding: Object.freeze({ containerId:item._containerId, fingerprint:item._fingerprint, port:item._port, state:item.state }) });
    },
    async confirm(plan) {
      if (!plan || !RUNTIME_ID.test(plan.runtimeId) || !ACTIONS.has(plan.action) || Date.now() >= Date.parse(plan.expiresAt)) throw new Error('External runtime plan is unavailable or expired.');
      const item = (await current()).find((candidate) => candidate.id === plan.runtimeId);
      if (!item || item._containerId !== plan.binding?.containerId || item._fingerprint !== plan.binding?.fingerprint || item._port !== plan.binding?.port || item.state !== plan.binding?.state) throw new Error('External runtime changed; create a new plan.');
      await execute({ sshTarget: await sshTargetProvider(), script: actionScript(item, plan.action), timeoutMs: plan.action === 'resume' ? 210000 : 60000 });
      const after = (await current()).find((candidate) => candidate.id === plan.runtimeId); const expected = plan.action === 'suspend' ? 'stopped' : 'running';
      if (!after || after.state !== expected) throw new Error('External runtime postcondition was not verified.');
      return Object.freeze({ runtimeId:after.id, action:plan.action, state:after.state, displayName:after.displayName, resourceMiB:after.resourceMiB });
    },
  });
}

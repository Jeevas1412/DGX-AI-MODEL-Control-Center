import { createHash, randomUUID } from 'node:crypto';
import { executeRemoteScript } from './dgx-collector.mjs';

export const NVFP4_PARAMETER_ADAPTER_ID = 'nvfp4-startup-parameters';
export const NVFP4_PARAMETER_ADAPTER_VERSION = '1.1.1';

// This artifact is deliberately closed: only four allowlisted launch flags in
// one registered script can be updated. It never starts, stops or restarts a service.
export const NVFP4_PARAMETER_ADAPTER_RUN_SH = String.raw`#!/usr/bin/env bash
set -euo pipefail
target="$HOME/ai/serve/serve_nvfp4_vllm_lazy_backend.sh"
root="$HOME/.dgx-ai-control-center/parameter-adapters/nvfp4-startup-parameters"
backup_root="$root/backups"
snapshot() {
  python3 - "$target" <<'PY'
import hashlib, json, re, sys
text=open(sys.argv[1],encoding='utf-8').read()
def capture(pattern,cast=str):
  found=re.search(pattern,text)
  if not found:return None
  try:return cast(found.group(1))
  except ValueError:return None
print(json.dumps({'status':'snapshot','integritySha256':'sha256:'+hashlib.sha256(text.encode('utf-8')).hexdigest(),'values':{'maxModelLen':capture(r'--max-model-len\s+(\d+)',int),'gpuMemoryUtilization':capture(r'--gpu-memory-utilization\s+([0-9.]+)',float),'maxNumSeqs':capture(r'--max-num-seqs\s+(\d+)',int),'maxNumBatchedTokens':capture(r'--max-num-batched-tokens\s+(\d+)',int),'kvCacheDtype':capture(r'--kv-cache-dtype\s+([A-Za-z0-9_-]+)'),'prefixCaching':'--enable-prefix-caching' in text,'mtpTokens':capture(r'--speculative-config.num_speculative_tokens\s+(\d+)',int)}},separators=(',',':')))
PY
}
apply() {
  mkdir -p "$backup_root"; umask 077
  python3 - "$target" "$backup_root" <<'PY'
import hashlib,json,os,pathlib,re,sys,tempfile,uuid
target=pathlib.Path(sys.argv[1]); backup_root=pathlib.Path(sys.argv[2]); request=json.load(sys.stdin)
allowed={'maxModelLen','gpuMemoryUtilization','maxNumSeqs','maxNumBatchedTokens'}
if set(request)!= {'expectedIntegritySha256','backupId','proposed'}: raise SystemExit('invalid apply request')
if not isinstance(request['backupId'],str) or str(uuid.UUID(request['backupId']))!=request['backupId']: raise SystemExit('invalid backup id')
p=request['proposed']
if not isinstance(p,dict) or not p or set(p)-allowed: raise SystemExit('invalid proposed fields')
checks={'maxModelLen':lambda v:isinstance(v,int) and 4096<=v<=65536,'gpuMemoryUtilization':lambda v:isinstance(v,(int,float)) and not isinstance(v,bool) and .5<=float(v)<=.9,'maxNumSeqs':lambda v:isinstance(v,int) and 1<=v<=128,'maxNumBatchedTokens':lambda v:isinstance(v,int) and 4096<=v<=65536}
if any(not checks[k](v) for k,v in p.items()): raise SystemExit('invalid proposed value')
before=target.read_bytes(); before_hash='sha256:'+hashlib.sha256(before).hexdigest()
if request['expectedIntegritySha256']!=before_hash: raise SystemExit('startup script changed since plan creation')
text=before.decode('utf-8'); patterns={'maxModelLen':r'(--max-model-len\s+)\d+','gpuMemoryUtilization':r'(--gpu-memory-utilization\s+)[0-9.]+','maxNumSeqs':r'(--max-num-seqs\s+)\d+','maxNumBatchedTokens':r'(--max-num-batched-tokens\s+)\d+'}
for key,value in p.items():
  text,count=re.subn(patterns[key],lambda m:m.group(1)+str(value),text,count=1)
  if count!=1: raise SystemExit('registered launch flag is missing: '+key)
backup=backup_root/(request['backupId']+'.sh')
if backup.exists(): raise SystemExit('backup id already exists')
backup.write_bytes(before); os.chmod(backup,0o600)
fd,tmp=tempfile.mkstemp(prefix='.nvfp4-',dir=target.parent); os.close(fd)
try:
  pathlib.Path(tmp).write_text(text,encoding='utf-8'); os.chmod(tmp,0o700); os.replace(tmp,target)
finally:
  if os.path.exists(tmp): os.unlink(tmp)
after_hash='sha256:'+hashlib.sha256(text.encode('utf-8')).hexdigest()
print(json.dumps({'status':'applied','backupId':request['backupId'],'beforeIntegritySha256':before_hash,'afterIntegritySha256':after_hash},separators=(',',':')))
PY
}
rollback() {
  python3 - "$target" "$backup_root" <<'PY'
import hashlib,json,os,pathlib,sys,tempfile,uuid
target=pathlib.Path(sys.argv[1]); backup_root=pathlib.Path(sys.argv[2]); request=json.load(sys.stdin)
if set(request)!= {'backupId'} or not isinstance(request['backupId'],str) or str(uuid.UUID(request['backupId']))!=request['backupId']: raise SystemExit('invalid rollback request')
backup=backup_root/(request['backupId']+'.sh')
if not backup.is_file(): raise SystemExit('backup does not exist')
before=target.read_bytes(); restored=backup.read_bytes(); fd,tmp=tempfile.mkstemp(prefix='.nvfp4-',dir=target.parent); os.close(fd)
try:
  pathlib.Path(tmp).write_bytes(restored); os.chmod(tmp,0o700); os.replace(tmp,target)
finally:
  if os.path.exists(tmp):os.unlink(tmp)
print(json.dumps({'status':'rolled-back','backupId':request['backupId'],'beforeIntegritySha256':'sha256:'+hashlib.sha256(before).hexdigest(),'afterIntegritySha256':'sha256:'+hashlib.sha256(restored).hexdigest()},separators=(',',':')))
PY
}
case "$1" in snapshot) snapshot ;; apply) apply ;; rollback) rollback ;; *) echo 'unsupported parameter adapter action' >&2; exit 64 ;; esac
`;

export const NVFP4_PARAMETER_ADAPTER_INTEGRITY = `sha256:${createHash('sha256').update(NVFP4_PARAMETER_ADAPTER_RUN_SH, 'utf8').digest('hex')}`;
export const NVFP4_PARAMETER_ADAPTER_MANIFEST = Object.freeze({ schemaVersion: 1, id: NVFP4_PARAMETER_ADAPTER_ID, version: NVFP4_PARAMETER_ADAPTER_VERSION, integritySha256: NVFP4_PARAMETER_ADAPTER_INTEGRITY, target: 'nvfp4-startup-script', actions: Object.freeze(['snapshot', 'apply', 'rollback']) });
function deploymentScript() { const manifest=Buffer.from(`${JSON.stringify(NVFP4_PARAMETER_ADAPTER_MANIFEST)}\n`,'utf8').toString('base64'); const artifact=Buffer.from(NVFP4_PARAMETER_ADAPTER_RUN_SH,'utf8').toString('base64'); return `set -euo pipefail\numask 077\nroot="$HOME/.dgx-ai-control-center/parameter-adapters/${NVFP4_PARAMETER_ADAPTER_ID}"\nmkdir -p "$root"\nprintf %s '${manifest}' | base64 -d > "$root/manifest.json"\nprintf %s '${artifact}' | base64 -d > "$root/run.sh"\nchmod 700 "$root/run.sh"\nchmod 600 "$root/manifest.json"\npython3 - "$root" <<'PY'\nimport hashlib,json,pathlib,sys\nroot=pathlib.Path(sys.argv[1]); manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8')); digest='sha256:'+hashlib.sha256((root/'run.sh').read_bytes()).hexdigest()\nif manifest.get('integritySha256') != digest: raise SystemExit('parameter adapter integrity mismatch')\nprint(json.dumps({'status':'deployed','id':manifest.get('id'),'version':manifest.get('version'),'integritySha256':digest},separators=(',',':')))\nPY`; }
const DISCOVERY_SCRIPT=String.raw`python3 - <<'PY'
import hashlib,json,pathlib
root=pathlib.Path.home()/'.dgx-ai-control-center'/'parameter-adapters'/'nvfp4-startup-parameters'
try:
 manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8')); digest='sha256:'+hashlib.sha256((root/'run.sh').read_bytes()).hexdigest(); print(json.dumps({'present':True,'manifest':manifest,'observedIntegritySha256':digest},separators=(',',':')))
except (OSError,ValueError,UnicodeDecodeError): print(json.dumps({'present':False},separators=(',',':')))
PY`;
function valid(payload) { return payload?.present===true && payload?.manifest?.id===NVFP4_PARAMETER_ADAPTER_ID && payload?.manifest?.version===NVFP4_PARAMETER_ADAPTER_VERSION && payload?.manifest?.integritySha256===NVFP4_PARAMETER_ADAPTER_INTEGRITY && payload?.observedIntegritySha256===NVFP4_PARAMETER_ADAPTER_INTEGRITY; }
function parse(raw, expected) { let payload; try { payload=JSON.parse(raw); } catch { throw new Error('NVFP4 parameter adapter returned invalid data.'); } if (payload?.status!==expected) throw new Error('NVFP4 parameter adapter action was rejected.'); return payload; }
export function createNvfp4ParameterAdapter({sshTargetProvider,execute=executeRemoteScript}={}) { if(typeof sshTargetProvider!=='function'||typeof execute!=='function')throw new Error('NVFP4 parameter adapter is unavailable.'); const remote=async(action,payload)=>{const encoded=Buffer.from(JSON.stringify(payload??{}),'utf8').toString('base64');return execute({sshTarget:await sshTargetProvider(),script:action==='snapshot'?`exec "$HOME/.dgx-ai-control-center/parameter-adapters/${NVFP4_PARAMETER_ADAPTER_ID}/run.sh" snapshot\n`:`printf %s '${encoded}' | base64 -d | "$HOME/.dgx-ai-control-center/parameter-adapters/${NVFP4_PARAMETER_ADAPTER_ID}/run.sh" ${action}\n`,timeoutMs:30_000});}; const status=async()=>{let payload;try{payload=JSON.parse(await execute({sshTarget:await sshTargetProvider(),script:DISCOVERY_SCRIPT,timeoutMs:15_000}));}catch{throw new Error('NVFP4 parameter adapter status is invalid.');}return Object.freeze({installed:valid(payload),id:NVFP4_PARAMETER_ADAPTER_ID,version:NVFP4_PARAMETER_ADAPTER_VERSION,integritySha256:NVFP4_PARAMETER_ADAPTER_INTEGRITY});}; return Object.freeze({status,async deploy(){const payload=parse(await execute({sshTarget:await sshTargetProvider(),script:deploymentScript(),timeoutMs:30_000}),'deployed');if(payload.id!==NVFP4_PARAMETER_ADAPTER_ID||payload.version!==NVFP4_PARAMETER_ADAPTER_VERSION||payload.integritySha256!==NVFP4_PARAMETER_ADAPTER_INTEGRITY)throw new Error('NVFP4 parameter adapter deployment verification failed.');return status();},async snapshot(){return parse(await remote('snapshot'),'snapshot');},async apply(input){return parse(await remote('apply',input),'applied');},async rollback(input){return parse(await remote('rollback',input),'rolled-back');},newDeploymentPlan(){return Object.freeze({id:randomUUID(),adapterId:NVFP4_PARAMETER_ADAPTER_ID,adapterVersion:NVFP4_PARAMETER_ADAPTER_VERSION,adapterIntegritySha256:NVFP4_PARAMETER_ADAPTER_INTEGRITY,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),status:'awaiting-confirmation'});}});}

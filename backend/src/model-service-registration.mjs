import { randomUUID } from 'node:crypto';
import { executeRemoteScript } from './dgx-collector.mjs';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9-]{36}$/;
const ID = /^[a-z0-9-]{3,64}$/;

function requiredText(value, expression, label) {
  if (typeof value !== 'string' || !expression.test(value)) throw new Error(`Invalid managed registration ${label}.`);
  return value;
}

function remoteScript(record) {
  const encoded = Buffer.from(JSON.stringify(record), 'utf8').toString('base64');
  return String.raw`set -euo pipefail
umask 077
root="$HOME/.dgx-ai-control-center/registrations"
target="$root/registry.json"
mkdir -p "$root"
payload="$(printf %s '${encoded}' | base64 -d)"
python3 - "$target" "$payload" <<'PY'
import json, os, sys, tempfile
path, raw = sys.argv[1], sys.argv[2]
entry = json.loads(raw)
allowed = {'schemaVersion', 'registrationId', 'configurationId', 'catalogEntryId', 'targetMachineSha256', 'templateId', 'displayName', 'adapter', 'registeredAt'}
if set(entry) != allowed or entry['schemaVersion'] != 1:
    raise SystemExit('invalid registration payload')
if not isinstance(entry['adapter'], dict) or set(entry['adapter']) != {'id', 'version', 'integritySha256'}:
    raise SystemExit('invalid adapter binding')
doc = {'schemaVersion': 1, 'entries': []}
if os.path.exists(path):
    with open(path, encoding='utf-8') as source: doc = json.load(source)
    if not isinstance(doc, dict) or doc.get('schemaVersion') != 1 or not isinstance(doc.get('entries'), list):
        raise SystemExit('existing managed registry is invalid')
    for old in doc['entries']:
        if old.get('configurationId') == entry['configurationId']:
            if old == entry:
                print(json.dumps({'status':'already-registered','registrationId':entry['registrationId']})); raise SystemExit(0)
            raise SystemExit('configuration already has a different registration')
if len(doc['entries']) >= 50: raise SystemExit('managed registry limit reached')
doc['entries'].append(entry)
fd, temporary = tempfile.mkstemp(prefix='.registry-', dir=os.path.dirname(path), text=True)
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        json.dump(doc, output, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
        output.write('\n'); output.flush(); os.fsync(output.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
print(json.dumps({'status':'registered','registrationId':entry['registrationId']}))
PY
`;
}

export function createModelServiceRegistrar({ sshTargetProvider, execute = executeRemoteScript, now = () => new Date() } = {}) {
  if (typeof sshTargetProvider !== 'function' || typeof execute !== 'function') throw new Error('Managed service registrar is unavailable.');
  return Object.freeze({
    async register(input) {
      const record = Object.freeze({ schemaVersion: 1, registrationId: requiredText(input.registrationId ?? randomUUID(), UUID, 'id'), configurationId: requiredText(input.configurationId, UUID, 'configuration id'), catalogEntryId: requiredText(input.catalogEntryId, UUID, 'catalog entry id'), targetMachineSha256: requiredText(input.targetMachineSha256, SHA256, 'target'), templateId: requiredText(input.templateId, ID, 'template'), displayName: requiredText(input.displayName, /^[^\r\n]{1,96}$/, 'display name'), adapter: Object.freeze({ id: requiredText(input.adapter?.id, ID, 'adapter id'), version: requiredText(input.adapter?.version, /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/, 'adapter version'), integritySha256: requiredText(input.adapter?.integritySha256, SHA256, 'adapter integrity') }), registeredAt: now().toISOString() });
      const output = await execute({ sshTarget: await sshTargetProvider(), script: remoteScript(record), timeoutMs: 15_000 });
      let result; try { result = JSON.parse(output); } catch { throw new Error('Managed service registry returned invalid JSON.'); }
      if (!result || !['registered', 'already-registered'].includes(result.status) || result.registrationId !== record.registrationId) throw new Error('Managed service registry rejected the registration.');
      return Object.freeze({ ...record, status: result.status });
    },
  });
}

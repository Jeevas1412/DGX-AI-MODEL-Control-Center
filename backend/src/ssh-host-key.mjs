import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

function requireAlias(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new Error('SSH host-key lookup requires an OpenSSH alias.');
  }
  return value;
}

function append(output, chunk, child) {
  const next = output + chunk;
  if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT_BYTES) child.kill();
  return next;
}

/** Executes a fixed local OpenSSH utility invocation without a shell. */
export function executeLocalOpenSsh({ program, args, timeoutMs = DEFAULT_TIMEOUT_MS, spawnProcess = spawn }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
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
      finish(reject, new Error('OpenSSH host-key lookup timed out.'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk, child); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk, child); });
    child.on('error', (error) => finish(reject, new Error(`Unable to start ${program}: ${error.message}`)));
    child.on('close', (code) => {
      if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES || Buffer.byteLength(stderr, 'utf8') > MAX_OUTPUT_BYTES) {
        finish(reject, new Error('OpenSSH host-key lookup exceeded the output limit.'));
      } else if (code !== 0) {
        finish(reject, new Error(`${program} failed${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
      } else {
        finish(resolve, stdout);
      }
    });
  });
}

export function fingerprintFromPublicKeyBlob(encodedKey) {
  if (typeof encodedKey !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey)) return null;
  try {
    return `SHA256:${createHash('sha256').update(Buffer.from(encodedKey, 'base64')).digest('base64').replace(/=+$/, '')}`;
  } catch {
    return null;
  }
}

export function fingerprintsFromKnownHosts(output) {
  if (typeof output !== 'string') return [];
  const fingerprints = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/(?:^|\s)((?:ssh-[A-Za-z0-9@._+-]+|ecdsa-sha2-nistp[0-9]+|sk-[A-Za-z0-9@._+-]+))\s+([A-Za-z0-9+/]+={0,2})(?:\s|$)/);
    const fingerprint = match ? fingerprintFromPublicKeyBlob(match[2]) : null;
    if (fingerprint) fingerprints.add(fingerprint);
  }
  return [...fingerprints];
}

function sshConfigValue(output, key) {
  const prefix = `${key.toLowerCase()} `;
  const line = output.split(/\r?\n/).find((item) => item.toLowerCase().startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

function resolvedHostTarget(output) {
  const host = sshConfigValue(output, 'hostkeyalias') || sshConfigValue(output, 'hostname');
  const port = sshConfigValue(output, 'port') || '22';
  if (!host) throw new Error('OpenSSH alias did not resolve a host name.');
  return port === '22' ? host : `[${host}]:${port}`;
}

/**
 * Reads the fingerprint that OpenSSH itself would require for an alias. This
 * reads only local configuration/known_hosts; it never opens an SSH session.
 */
export function createKnownHostFingerprintLookup({ execute = executeLocalOpenSsh } = {}) {
  if (typeof execute !== 'function') throw new Error('Known-host lookup execute must be a function.');
  return async (sshAlias) => {
    const alias = requireAlias(sshAlias);
    const config = await execute({ program: 'ssh', args: ['-G', alias] });
    const knownHostsFiles = sshConfigValue(config, 'userknownhostsfile')
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item && item.toLowerCase() !== 'none');
    const hostTarget = resolvedHostTarget(config);
    const matches = [];
    for (const filePath of knownHostsFiles) {
      try {
        matches.push(await execute({ program: 'ssh-keygen', args: ['-F', hostTarget, '-f', filePath] }));
      } catch {
        // Try the remaining configured known_hosts files. A missing file is not
        // a successful identity verification.
      }
    }
    const fingerprints = fingerprintsFromKnownHosts(matches.join('\n'));
    if (fingerprints.length === 0) throw new Error('No trusted SSH host key is recorded for this connection profile.');
    // A host may legitimately have multiple trusted algorithm keys. Return the
    // complete trusted set; the caller compares the configured fingerprint
    // against membership instead of arbitrarily choosing one key.
    return Object.freeze(fingerprints);
  };
}

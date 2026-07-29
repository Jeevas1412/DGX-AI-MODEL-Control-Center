const SENSITIVE_KEY = /(token|password|secret|api[_-]?key|authorization|private[_-]?key)/i;

function redact(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}

/** Builds an auditable, non-executable change record. It performs no persistence. */
export function createChangeAuditRecord({ changeId, actor, approver, snapshotId, scriptHash, review, now = () => new Date().toISOString() } = {}) {
  const missing = ['changeId', 'actor', 'snapshotId', 'scriptHash'].filter((field) => !arguments[0]?.[field]);
  if (missing.length) throw new Error(`Missing required audit fields: ${missing.join(', ')}.`);
  return Object.freeze({
    changeId,
    recordedAt: now(),
    actor,
    approver: approver ?? null,
    snapshotId,
    scriptHash,
    review: redact(review ?? {}),
    executionAllowed: false,
    executionResult: 'not-executed',
  });
}

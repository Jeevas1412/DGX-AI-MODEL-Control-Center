const HIGH_RISK_FIELDS = Object.freeze({
  maxModelLen: { flag: '--max-model-len', type: 'positiveInteger' },
  gpuMemoryUtilization: { flag: '--gpu-memory-utilization', type: 'unitInterval' },
  maxNumSeqs: { flag: '--max-num-seqs', type: 'positiveInteger' },
  maxNumBatchedTokens: { flag: '--max-num-batched-tokens', type: 'positiveInteger' },
  kvCacheDtype: { flag: '--kv-cache-dtype', type: 'enum', values: ['fp8'] },
  prefixCaching: { flag: '--enable-prefix-caching', type: 'boolean' },
  mtpTokens: { flag: '--speculative-config.num_speculative_tokens', type: 'positiveInteger' },
});

export const NVFP4_CANDIDATE_FIELDS = Object.freeze(Object.keys(HIGH_RISK_FIELDS));

function valueMatches(policy, value) {
  if (policy.type === 'positiveInteger') return Number.isInteger(value) && value > 0;
  if (policy.type === 'unitInterval') return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
  if (policy.type === 'boolean') return typeof value === 'boolean';
  if (policy.type === 'enum') return policy.values.includes(value);
  return false;
}

/**
 * Validates a proposed structured review. This is deliberately not an executor:
 * it produces no commands, opens no files, and has no network capability.
 */
export function reviewNvfp4Change({ service, current, proposed, snapshotId, scriptHash } = {}) {
  const errors = [];
  if (service !== 'nvfp4') errors.push('Only the nvfp4 candidate policy is supported.');
  if (!snapshotId || typeof snapshotId !== 'string') errors.push('A verified snapshotId is required.');
  if (!scriptHash || typeof scriptHash !== 'string') errors.push('A verified scriptHash is required.');
  if (!current || typeof current !== 'object' || Array.isArray(current)) errors.push('current must be an object.');
  if (!proposed || typeof proposed !== 'object' || Array.isArray(proposed)) errors.push('proposed must be an object.');
  if (errors.length) return { approvedForExecution: false, errors, changes: [] };

  const changes = [];
  for (const [field, value] of Object.entries(proposed)) {
    const policy = HIGH_RISK_FIELDS[field];
    if (!policy) {
      errors.push(`Field is not allowlisted: ${field}`);
      continue;
    }
    if (!valueMatches(policy, value)) {
      errors.push(`Invalid value for ${field}.`);
      continue;
    }
    if (current[field] !== value) {
      changes.push({ field, flag: policy.flag, from: current[field], to: value, risk: 'high', requiresRestart: true });
    }
  }

  if (changes.length === 0 && errors.length === 0) errors.push('The proposed change contains no effective allowlisted updates.');
  return {
    approvedForExecution: false,
    errors,
    changes,
    requiredGates: changes.length ? ['verified-snapshot', 'risk-review', 'independent-approval', 'change-window', 'second-confirmation', 'post-change-health-check'] : [],
  };
}

import { findModelServiceTemplate } from './model-service-templates.mjs';

const ACTIONS = new Set(['warmup', 'restart', 'stop']);
const PARAMETER_TYPES = new Set(['integer', 'number', 'boolean']);

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`Invalid ${label}.`);
  return value;
}

function nonEmpty(value, label, pattern, maximum = 128) {
  if (typeof value !== 'string' || !pattern.test(value) || value.length > maximum) throw new Error(`Invalid ${label}.`);
  return value;
}

/** Product-managed adapter manifest. It deliberately contains no shell, path,
 * container, port, environment-variable or arbitrary endpoint fields. */
export function validateModelServiceAdapterManifest(value) {
  const manifest = exactObject(value, ['schemaVersion', 'id', 'version', 'templateId', 'modelIds', 'artifact', 'integritySha256', 'actions', 'healthCheck', 'resourceBudget', 'rollback', 'parameters'], 'model service adapter manifest');
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported model service adapter manifest version.');
  const template = findModelServiceTemplate(manifest.templateId);
  if (!template) throw new Error('Adapter references an unsupported service template.');
  // A template alone is not a sufficient authority to bind an adapter to a
  // newly discovered model.  An adapter must explicitly name the stable DGX
  // model identifiers it supports.  Legacy adapters without this field remain
  // usable only by an already registered exact id/version/digest binding.
  const modelIds = manifest.modelIds === undefined ? [] : manifest.modelIds;
  if (!Array.isArray(modelIds) || modelIds.length > 20 || new Set(modelIds).size !== modelIds.length
    || modelIds.some((id) => typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,127}$/i.test(id))) {
    throw new Error('Adapter model identifiers are invalid.');
  }
  const actions = manifest.actions;
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > 3 || actions.some((action) => !ACTIONS.has(action) || !template.actions.includes(action)) || new Set(actions).size !== actions.length) throw new Error('Adapter actions are invalid.');
  const healthCheck = exactObject(manifest.healthCheck, ['kind'], 'adapter health check');
  if (!['service-health', 'workflow-ready'].includes(healthCheck.kind)) throw new Error('Adapter health check is invalid.');
  const resourceBudget = exactObject(manifest.resourceBudget, ['estimatedMemoryMiB', 'basis', 'observedMemoryMiB', 'startupBufferMiB'], 'adapter resource budget');
  if (!Number.isInteger(resourceBudget.estimatedMemoryMiB) || resourceBudget.estimatedMemoryMiB < 0 || resourceBudget.estimatedMemoryMiB > 1024 * 1024) throw new Error('Adapter resource budget is invalid.');
  const budgetBasis = resourceBudget.basis === undefined ? 'configured-reservation' : resourceBudget.basis;
  if (!['configured-reservation', 'measured-profile'].includes(budgetBasis)) throw new Error('Adapter resource budget basis is invalid.');
  const observedMemoryMiB = resourceBudget.observedMemoryMiB === undefined ? null : resourceBudget.observedMemoryMiB;
  const startupBufferMiB = resourceBudget.startupBufferMiB === undefined ? null : resourceBudget.startupBufferMiB;
  if (budgetBasis === 'measured-profile') {
    if (!Number.isInteger(observedMemoryMiB) || !Number.isInteger(startupBufferMiB) || observedMemoryMiB < 0 || startupBufferMiB < 0 || observedMemoryMiB + startupBufferMiB !== resourceBudget.estimatedMemoryMiB) throw new Error('Measured adapter resource budget is invalid.');
  } else if (observedMemoryMiB !== null || startupBufferMiB !== null) {
    throw new Error('Configured adapter resource budget cannot include measured values.');
  }
  const rollback = exactObject(manifest.rollback, ['kind'], 'adapter rollback');
  if (rollback.kind !== 'restore-previous-registration') throw new Error('Adapter rollback is invalid.');
  if (manifest.artifact !== 'run.sh') throw new Error('Adapter artifact is invalid.');
  const parameters = manifest.parameters === undefined ? [] : manifest.parameters;
  if (!Array.isArray(parameters) || parameters.length > 12) throw new Error('Adapter parameters are invalid.');
  const parameterIds = new Set();
  const safeParameters = parameters.map((parameter) => {
    const item = exactObject(parameter, ['id', 'type', 'minimum', 'maximum', 'step', 'risk'], 'adapter parameter');
    const id = nonEmpty(item.id, 'adapter parameter id', /^[a-z][a-z0-9-]{1,47}$/);
    if (parameterIds.has(id)) throw new Error('Adapter parameters are invalid.');
    parameterIds.add(id);
    if (!PARAMETER_TYPES.has(item.type)) throw new Error('Adapter parameter type is invalid.');
    if (!['medium', 'high'].includes(item.risk)) throw new Error('Adapter parameter risk is invalid.');
    if (item.type === 'boolean') {
      if (item.minimum !== null || item.maximum !== null || item.step !== null) throw new Error('Boolean adapter parameter range is invalid.');
    } else if (!Number.isFinite(item.minimum) || !Number.isFinite(item.maximum) || !Number.isFinite(item.step) || item.minimum >= item.maximum || item.step <= 0 || item.step > item.maximum - item.minimum) {
      throw new Error('Numeric adapter parameter range is invalid.');
    }
    return Object.freeze({ id, type: item.type, minimum: item.minimum, maximum: item.maximum, step: item.step, risk: item.risk });
  });
  const safeResourceBudget = budgetBasis === 'measured-profile'
    ? Object.freeze({ estimatedMemoryMiB: resourceBudget.estimatedMemoryMiB, basis: budgetBasis, observedMemoryMiB, startupBufferMiB })
    : Object.freeze({ estimatedMemoryMiB: resourceBudget.estimatedMemoryMiB });
  return Object.freeze({ schemaVersion: 1, id: nonEmpty(manifest.id, 'adapter id', /^adapter-[a-z0-9-]{3,64}$/), version: nonEmpty(manifest.version, 'adapter version', /^\d+\.\d+\.\d+$/), templateId: template.id, modelIds: Object.freeze([...modelIds]), artifact: 'run.sh', integritySha256: nonEmpty(manifest.integritySha256, 'adapter integrity', /^sha256:[a-f0-9]{64}$/), actions: Object.freeze([...actions]), healthCheck: Object.freeze({ kind: healthCheck.kind }), resourceBudget: safeResourceBudget, rollback: Object.freeze({ kind: rollback.kind }), parameters: Object.freeze(safeParameters) });
}

export function compatibleAdapterForDraft({ draft, modelId, manifest, observedIntegritySha256 }) {
  const safe = validateModelServiceAdapterManifest(manifest);
  if (!draft || safe.templateId !== draft.templateId) return Object.freeze({ compatible: false, reason: 'template-mismatch' });
  if (safe.integritySha256 !== observedIntegritySha256) return Object.freeze({ compatible: false, reason: 'integrity-mismatch' });
  if (typeof modelId === 'string' && !safe.modelIds.includes(modelId)) return Object.freeze({ compatible: false, reason: 'model-mismatch' });
  return Object.freeze({ compatible: true, adapter: safe });
}
